"""임금명세서 위반 분석 (LLM).

EC analyze 와 출력 스키마를 통일 — 프론트엔드가 한 컴포넌트로 두 문서를 표시 가능.

처리 순서
  1. 마스터 DB 에서 wage_statement 슬롯 11개 로드 (`ws.catalog.load_ws_catalog`).
  2. business_size + worker_types 로 적용 슬롯 필터.
  3. system + user 프롬프트 빌드 (슬롯·법령·노무사회 자료 attached).
  4. LLM 호출 → 결정성 보장 (temperature=0, json_object, llm_cache).
  5. 결과 dict 반환.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any

from openai import APIConnectionError, APITimeoutError, OpenAI, RateLimitError

from cgr import llm_cache
from cgr.config import get_api_key, get_llm_model
from cgr.pii_mask import mask_pii, summary as pii_summary
from cgr.ws.catalog import WsSlot, load_ws_catalog


_CALL_TIMEOUT = 120.0
_MAX_RETRIES = 3
_RETRY_BACKOFF = (2.0, 5.0, 10.0)


_SYSTEM_PROMPT = """\
당신은 「근로기준법 제48조 + 동법 시행령 제27조의2」 임금명세서 작성·교부 의무를 검토하는 노무 전문가입니다.

[검토 기준]
- 사용자가 제공한 임금명세서 원문을 읽고, 아래 슬롯 카탈로그에 정의된 항목 각각이
  - 적절히 기재되어 있는지(적절)
  - 기재는 있으나 분리·계산기초 등이 미흡한지(보완필요)
  - 누락 또는 명백히 위반인지(부적절)
  세 가지로 판정.
- 항목별 미기재 시 위험도는 슬롯 정의의 missing_severity 를 따른다.
- 모든 판정은 「근거 법령」 을 명시 — 슬롯의 laws 필드 또는 그 외 명백한 조문.

[출력 — 반드시 JSON, 키 한국어]
{
  "riskLevel": "상" | "중" | "하",
  "overallStatus": "위험" | "보완필요" | "적정",
  "overallOpinion": "전반적인 검토 결과 총평 (3~5문장)",
  "results": [
    {
      "항목": "<슬롯 field>",
      "적절성": "적절" | "보완필요" | "부적절",
      "발견내용": "원문에서 추출된 표현 (없으면 '미기재')",
      "판단이유": "기준과의 비교 + <meta db='DB_xxx' n='1.1' /> 메타 태그 포함",
      "법적근거": "근로기준법 ...",
      "개선권고": "구체적인 시정 예시"
    },
    ...
  ],
  "finalRecommendations": "최종 권고 (2~4문장)"
}

[중요]
- 슬롯 카탈로그에 포함된 항목 모두에 대해 results 행을 만들어야 함. 누락 금지.
- 항목명(field)은 슬롯 카탈로그의 표기를 그대로 사용.
"""


def _format_slots_for_prompt(slots: list[WsSlot]) -> str:
    """슬롯 카탈로그 → 프롬프트용 컴팩트 표기.

    '항목' 필드는 LLM 응답에 그대로 들어가므로 슬롯 ID 는 노출하지 않는다.
    """
    lines: list[str] = []
    for s in slots:
        lines.append(
            f"- 항목명: {s.field}\n"
            f"  · 기재내용: {s.required_content}\n"
            f"  · 필요이유: {s.purpose}\n"
            f"  · 미기재 위험도: {s.missing_severity} · 부적절 위험도: {s.violation_severity}\n"
            f"  · 관련법령: {', '.join(s.laws) or '—'}\n"
            f"  · 연관주제: {', '.join(s.topic_meta) or '—'}\n"
            f"  · 시정예시: {s.fix_example}"
        )
    return "\n\n".join(lines)


_SLOT_CODE_RE = re.compile(r"\s*\(SLOT_WS_[\w]+\)\s*")
_META_RE = re.compile(r"<meta\b[^>]*?>", re.IGNORECASE)


def _attach_real_topic_refs(
    result: dict[str, Any], slots: list["WsSlot"]
) -> dict[str, Any]:
    """LLM 이 판단이유에 넣은 <meta>(부정확·환각)를 제거하고, 각 슬롯의 **실제 연관주제**
    (topic_meta = '{토픽} {섹션}')로 교체 → '참고 자료' 칩이 항상 정확. idempotent."""
    try:
        by_field = {s.field: (s.topic_meta or []) for s in slots}
        for item in result.get("results", []) or []:
            if not isinstance(item, dict):
                continue
            field = (item.get("항목") or "").strip()
            reason = _META_RE.sub("", item.get("판단이유") or "")
            reason = re.sub(r"\s{2,}", " ", reason).strip()
            metas = ""
            for tm in by_field.get(field, [])[:4]:  # 칩 과다 방지
                topic, _, sec = (tm or "").rpartition(" ")
                if topic and sec:
                    metas += f"<meta db='DB_{topic}' n='{sec}' />"
            item["판단이유"] = (reason + (" " + metas if metas else "")).strip()
    except Exception:
        pass
    return result


def _strip_slot_codes(result: dict[str, Any]) -> dict[str, Any]:
    """LLM 이 응답에 슬롯 코드를 함께 적어둔 경우 깨끗이 제거 (post-process 안전망)."""
    if not isinstance(result, dict):
        return result
    for item in result.get("results", []) or []:
        if not isinstance(item, dict):
            continue
        for k in ("항목",):
            v = item.get(k)
            if isinstance(v, str):
                item[k] = _SLOT_CODE_RE.sub(" ", v).strip()
    return result


def _build_user_prompt(
    wage_text: str,
    slots: list[WsSlot],
    business_size: str,
    worker_types: list[str],
    pay_period_year: int | None = None,
    pay_period_month: int | None = None,
    contract_type: str | None = None,
    pay_cycle: str | None = None,
    weekly_hours: float | None = None,
) -> str:
    # 산정 대상 기간 + 적용 최저임금
    period_line = ""
    min_wage_line = ""
    if pay_period_year:
        period_label = f"{pay_period_year}년"
        if pay_period_month:
            period_label += f" {pay_period_month}월"
        period_line = f"- 산정 대상 기간: {period_label}\n"
        try:
            from cgr.ws import repository as ws_repo
            mw = ws_repo.get_minimum_wage(pay_period_year)
            if mw:
                min_wage_line = (
                    f"- 적용 최저임금 ({int(mw['year'])}년): "
                    f"시급 {int(mw['hourly_amount']):,}원 / "
                    f"월 환산 {int(mw['monthly_amount_209h']):,}원 (209h 기준)\n"
                )
        except Exception:
            pass

    # 계약 조건 (단순화된 WS 컨텍스트)
    contract_line = (
        f"- 계약 유형: {contract_type}\n" if contract_type else ""
    )
    cycle_line = (
        f"- 임금 지급 주기: {pay_cycle}\n" if pay_cycle else ""
    )
    hours_line = ""
    if weekly_hours and contract_type == "단시간":
        hours_line = f"- 주 소정근로시간: {weekly_hours:g}시간 (단시간)\n"

    return (
        f"[사업장 컨텍스트]\n"
        f"- 상시 근로자 수: {business_size or '미상'}\n"
        f"{contract_line}{cycle_line}{hours_line}"
        f"{period_line}{min_wage_line}\n"
        f"[검토 대상 임금명세서 원문]\n"
        f"```\n{wage_text.strip()}\n```\n\n"
        f"[슬롯 카탈로그 — 이 항목 11개를 모두 results 에 포함]\n"
        f"{_format_slots_for_prompt(slots)}\n\n"
        f"위 카탈로그의 각 슬롯에 대해 적절성·발견내용·판단이유·법적근거·개선권고를 채워 "
        f"지정된 JSON 형식으로 응답. "
        f"최저임금 미달 여부를 판단할 때는 위 '적용 최저임금' 을 기준으로. "
        f"단시간 근로자면 '주 소정근로시간' 을 비례 산정 기준으로 사용."
    )


_FALLBACK_RESULT: dict[str, Any] = {
    "riskLevel": "중",
    "overallStatus": "보완필요",
    "overallOpinion": "분석 중 오류가 발생했습니다.",
    "results": [],
    "finalRecommendations": "시스템 오류로 인해 분석을 완료하지 못했습니다. 다시 시도해주세요.",
}


def _safe_json_parse(raw: str, default: Any = None) -> Any:
    """openai json_object 응답 — 캡슐화·escape 안전 파싱."""
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        # 코드펜스 제거 후 재시도
        cleaned = raw.strip().lstrip("```json").lstrip("```").rstrip("```")
        try:
            return json.loads(cleaned)
        except Exception:
            return default


def run(
    wage_text: str,
    *,
    business_size: str = "",
    worker_types: list[str] | None = None,
    pay_period_year: int | None = None,
    pay_period_month: int | None = None,
    contract_type: str | None = None,
    pay_cycle: str | None = None,
    weekly_hours: float | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """임금명세서 텍스트 + 컨텍스트 → 위반 분석 결과 dict."""
    if not isinstance(wage_text, str) or not wage_text.strip():
        raise ValueError("wage_text 가 비어있습니다.")

    # ─── PII 비식별 게이트 ─── 외부 LLM 호출 전 마스킹.
    masked = mask_pii(wage_text)
    wage_text = masked.masked
    if masked.counts:
        from cgr.log import get_logger

        get_logger(__name__).info(
            "[ws.analyze] PII 마스킹 적용: %s", pii_summary(masked)
        )

    catalog = load_ws_catalog()
    applicable = [
        s for s in catalog.slots if s.applies_to(business_size, worker_types or [])
    ]
    if not applicable:
        raise RuntimeError("적용 가능한 슬롯이 없습니다 — 카탈로그·컨텍스트 확인 필요.")

    model_name = get_llm_model(model)
    from cgr import prompt_store

    sys_prompt = prompt_store.get_or_default("ws_analyze", _SYSTEM_PROMPT)
    user_prompt = _build_user_prompt(
        wage_text,
        applicable,
        business_size or "",
        worker_types or [],
        pay_period_year=pay_period_year,
        pay_period_month=pay_period_month,
        contract_type=contract_type,
        pay_cycle=pay_cycle,
        weekly_hours=weekly_hours,
    )

    cache_key = llm_cache.make_key(
        system=sys_prompt,
        user=user_prompt,
        schema={"kind": "ws_analyze"},
        model=model_name,
    )
    cached = llm_cache.get(cache_key)
    if cached is not None and isinstance(cached.get("analysis"), dict):
        # 기존 캐시도 슬롯 코드·부정확 meta 새어나갔을 수 있어 항상 정리·교정
        return _attach_real_topic_refs(_strip_slot_codes(cached["analysis"]), applicable)

    client = OpenAI(api_key=get_api_key(), timeout=_CALL_TIMEOUT)
    last_err: Exception | None = None

    for attempt in range(_MAX_RETRIES):
        try:
            resp = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0,
                top_p=1,
            )
            raw = resp.choices[0].message.content or ""
            data = _safe_json_parse(raw, default=None)
            if not isinstance(data, dict) or "results" not in data:
                raise RuntimeError(
                    f"ws analyze 응답 형식이 올바르지 않습니다: {raw[:200]}"
                )
            data = _strip_slot_codes(data)
            # 참고 자료 = LLM <meta> 대신 슬롯의 실제 연관주제로 교체 (정확성·결정성)
            data = _attach_real_topic_refs(data, applicable)
            llm_cache.put(cache_key, {"analysis": data})
            return data
        except (APITimeoutError, APIConnectionError, RateLimitError) as e:
            last_err = e
            if attempt < _MAX_RETRIES - 1:
                time.sleep(_RETRY_BACKOFF[attempt])
                continue
            raise
        except Exception as e:
            last_err = e
            raise

    raise RuntimeError(f"ws analyze 호출 실패: {last_err}")


def fallback_result() -> dict[str, Any]:
    import copy
    return copy.deepcopy(_FALLBACK_RESULT)
