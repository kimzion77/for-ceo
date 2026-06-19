"""임금명세서 — 분석 결과 → 수정된 표준 임금명세서 텍스트 (LLM).

베타 단계.
입력: `/ws/analyze` 의 `analysis_result` 전체 + 원본 임금명세서 텍스트
출력: 시정 권고를 반영한 임금명세서 본문 (텍스트)

설계 원칙
- 결정성: temperature=0, llm_cache. 같은 입력 → 같은 출력
- 사용자 override: 사용자가 결과 페이지에서 "개선권고" 를 직접 편집한 케이스가 있으면
  분석 결과의 해당 항목을 사용자 표현으로 덮어쓰고 프롬프트 전달
"""
from __future__ import annotations

import json
import time
from typing import Any

from openai import APIConnectionError, APITimeoutError, OpenAI, RateLimitError

from cgr import llm_cache
from cgr.config import get_api_key, get_llm_model
from cgr.pii_mask import mask_pii_in_payload, mask_pii_text


_CALL_TIMEOUT = 90.0
_MAX_RETRIES = 3
_RETRY_BACKOFF = (2.0, 5.0, 10.0)


_SYSTEM_PROMPT = """\
당신은 한국 노동법(근로기준법 제48조 + 시행령 제27조의2) 전문가입니다.

[작업]
사용자가 제공한 (1) 원본 임금명세서 텍스트 + (2) 위반 분석 결과를 바탕으로,
시정 권고가 모두 반영된 **표준 임금명세서 텍스트** 를 한국어로 작성하세요.

[출력 양식 — 반드시 아래 구조를 그대로 유지]
[임금명세서]
산정 기간    : YYYY-MM-DD ~ YYYY-MM-DD
지급일       : YYYY-MM-DD
교부 방식    : (서면 / 전자문서 — 이메일·앱·문자 등)

[근로자 정보]
성명         : ○○○
사번/생년월일 : ...

[사용자 정보]
상호         : ...
사업자등록번호: ...

[근로시간]
근로일수    : N일
근로시간    : Nh
연장근로    : Nh
야간근로    : Nh
휴일근로    : Nh

[지급 내역]
- 기본급             : 금액
- 연장근로수당        : 금액 (계산: 통상시급 × 1.5 × Nh)
- 야간근로수당        : 금액 (계산: ...)
- 휴일근로수당        : 금액
- 식대               : 금액 (월 20만원 비과세)
- (기타 항목)
지급 총액            : 금액

[공제 내역]
- 근로소득세         : 금액
- 국민연금           : 금액 (보수월액의 4.5%)
- 건강보험           : 금액
- 장기요양보험        : 금액
- 고용보험           : 금액
- (기타 공제)
공제 총액            : 금액

[실수령액]
실수령액             : 금액

[비고]
(분석에서 지적된 누락·부적절 항목을 모두 보완한 사항. 사용자 확인이 필요한 부분은 [확인 필요] 로 표시)

[원칙]
- 분석 결과의 모든 '부적절' / '보완필요' 항목을 시정.
- 금액·기간 등 원본에서 알 수 없는 값은 그대로 두되 [확인 필요] 표시.
- 법령 근거를 본문에 인용하지 않고 비고에만 최소 언급.
- 출력은 위 양식만. 다른 해설·서두·맺음말 금지.

[문서 문체 규칙 — 절대 위반 금지]
- 분석 결과의 '개선권고'/사용자 보완 표현이 설명문(예: "수당을 명시해야 해요",
  "~하는 것이 좋습니다")이면 그대로 넣지 말고, 명세서 항목·수치 형식으로
  변환해 기재하세요. "~해요/~하세요/권장/필요합니다" 같은 표현은 최종
  명세서에 등장 금지.
"""


def _build_user_prompt(
    analysis_result: dict[str, Any],
    wage_text: str,
    user_overrides: dict[str, str] | None = None,
) -> str:
    """원본 + 분석 결과 → user prompt."""
    overrides = user_overrides or {}
    # 분석 결과의 results 를 카탈로그식으로 압축
    lines: list[str] = []
    for r in analysis_result.get("results", []):
        rec = overrides.get(r.get("항목", "")) or r.get("개선권고", "")
        lines.append(
            f"- 항목: {r.get('항목')}\n"
            f"  적절성: {r.get('적절성')}\n"
            f"  발견내용: {r.get('발견내용')}\n"
            f"  개선권고: {rec}"
        )
    findings_block = "\n".join(lines) or "(분석 결과 없음)"

    overall = analysis_result.get("overallStatus", "")
    risk = analysis_result.get("riskLevel", "")
    final_rec = analysis_result.get("finalRecommendations", "")

    return (
        f"[원본 임금명세서 텍스트]\n"
        f"```\n{wage_text.strip()[:6000]}\n```\n\n"
        f"[종합 판정] {overall} / 위험도 {risk}\n"
        f"[최종 권고] {final_rec}\n\n"
        f"[항목별 분석]\n{findings_block}\n\n"
        f"위 분석을 모두 반영한 표준 임금명세서를 위 양식으로 작성."
    )


def run(
    analysis_result: dict[str, Any],
    wage_text: str,
    *,
    user_overrides: dict[str, str] | None = None,
    model: str | None = None,
) -> str:
    """분석 결과 → 수정된 표준 임금명세서 텍스트."""
    if not isinstance(analysis_result, dict):
        raise ValueError("analysis_result 가 dict 가 아닙니다.")

    # ─── PII 비식별 게이트 — 분석 결과(중첩 dict) + 본문 텍스트 모두 마스킹 ───
    analysis_result = mask_pii_in_payload(analysis_result)
    wage_text = mask_pii_text(wage_text)

    model_name = get_llm_model(model)
    sys_prompt = _SYSTEM_PROMPT
    user_prompt = _build_user_prompt(analysis_result, wage_text, user_overrides)

    cache_key = llm_cache.make_key(
        system=sys_prompt,
        user=user_prompt,
        schema={"kind": "ws_generate"},
        model=model_name,
    )
    cached = llm_cache.get(cache_key)
    if cached and isinstance(cached.get("wage_text"), str):
        return cached["wage_text"]

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
                temperature=0,
                top_p=1,
            )
            text = (resp.choices[0].message.content or "").strip()
            if not text:
                raise RuntimeError("ws generate 응답이 비어있습니다.")
            llm_cache.put(cache_key, {"wage_text": text})
            return text
        except (APITimeoutError, APIConnectionError, RateLimitError) as e:
            last_err = e
            if attempt < _MAX_RETRIES - 1:
                time.sleep(_RETRY_BACKOFF[attempt])
                continue
            raise
        except Exception as e:
            last_err = e
            raise

    raise RuntimeError(f"ws generate 호출 실패: {last_err}")


# ════════════════════════════════════════════════════════════════
# 구조화 출력 — 공식 임금명세서 서식(공란)을 칸별로 채우기 위한 JSON.
# 프론트의 비주얼 양식 뷰(WsPayslipFormView)가 각 칸에 그대로 바인딩.
# ════════════════════════════════════════════════════════════════

_FORM_SYSTEM_PROMPT = """\
당신은 한국 노동법(근로기준법 제48조 + 시행령 제27조의2) 전문가입니다.

[작업]
(1) 원본 임금명세서 텍스트 + (2) 위반 분석 결과를 바탕으로, 고용노동부 표준
임금명세서 서식의 각 칸을 채운 **구조화 JSON** 을 출력하세요. 분석에서 지적된
'부적절'/'보완필요' 항목은 모두 시정해 반영합니다.

[출력 — 반드시 아래 JSON 스키마. 키는 영문 그대로, 값은 한국어]
{
  "settlementPeriod": "산정 기간 (예: 2026-05-01 ~ 2026-05-31), 모르면 ''",
  "paymentDate": "지급일 (YYYY-MM-DD), 모르면 ''",
  "deliveryMethod": "교부 방식 (서면/이메일/사내게시 등), 모르면 ''",
  "worker":   { "name": "성명", "idOrBirth": "사번 또는 생년월일", "dept": "부서", "position": "직급" },
  "employer": { "company": "상호", "businessNo": "사업자등록번호", "ceo": "대표자", "address": "주소" },
  "workTime": { "days": "근로일수", "hours": "총 근로시간", "overtime": "연장", "night": "야간", "holiday": "휴일" },
  "payments":   [ { "name": "기본급", "amount": "1,800,000", "basis": "계산방법(없으면 '')", "supplemented": false } ],
  "paymentTotal": "지급 총액",
  "deductions": [ { "name": "국민연금", "amount": "81,000", "basis": "보수월액의 4.5%", "supplemented": false } ],
  "deductionTotal": "공제 총액",
  "netPay": "실수령액",
  "supplementedFields": ["deliveryMethod", "employer", ...],
  "notes": ["보완·확인 필요 사항 한 줄씩"]
}

[규칙]
- 금액은 숫자 콤마 표기('1,234,560'), 단위 '원' 은 붙이지 않는다.
- 원본에서 알 수 없는 값은 '' 로 두고 notes 에 '[확인 필요] ...' 로 적는다. 임의 추정 금지.
- 분석으로 새로 추가·보완한 지급/공제 항목은 그 항목의 "supplemented": true.
- 머리말 칸(교부 방식·사용자 정보 등)을 보완했으면 그 키를 supplementedFields 에 넣는다.
- 설명문("~해야 해요" 등)은 명세서 표기로 변환. JSON 외 텍스트 출력 금지.
"""


_FORM_FALLBACK: dict[str, Any] = {
    "settlementPeriod": "", "paymentDate": "", "deliveryMethod": "",
    "worker": {}, "employer": {}, "workTime": {},
    "payments": [], "paymentTotal": "",
    "deductions": [], "deductionTotal": "", "netPay": "",
    "supplementedFields": [], "notes": [],
}


def _safe_json(raw: str) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        cleaned = raw.strip().lstrip("```json").lstrip("```").rstrip("```")
        try:
            return json.loads(cleaned)
        except Exception:
            return None


def run_structured(
    analysis_result: dict[str, Any],
    wage_text: str,
    *,
    user_overrides: dict[str, str] | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """분석 결과 → 공식 임금명세서 서식 칸을 채운 구조화 dict."""
    if not isinstance(analysis_result, dict):
        raise ValueError("analysis_result 가 dict 가 아닙니다.")

    analysis_result = mask_pii_in_payload(analysis_result)
    wage_text = mask_pii_text(wage_text)

    model_name = get_llm_model(model)
    user_prompt = _build_user_prompt(analysis_result, wage_text, user_overrides)

    cache_key = llm_cache.make_key(
        system=_FORM_SYSTEM_PROMPT,
        user=user_prompt,
        schema={"kind": "ws_generate_form"},
        model=model_name,
    )
    cached = llm_cache.get(cache_key)
    if cached and isinstance(cached.get("form"), dict):
        return cached["form"]

    client = OpenAI(api_key=get_api_key(), timeout=_CALL_TIMEOUT)
    last_err: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            resp = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": _FORM_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0,
                top_p=1,
            )
            raw = resp.choices[0].message.content or ""
            data = _safe_json(raw)
            if not isinstance(data, dict):
                raise RuntimeError(f"ws generate-form 응답 형식 오류: {raw[:200]}")
            # 안전 기본값 머지 — 누락 키 있어도 프론트가 안전하게 렌더.
            form = {**_FORM_FALLBACK, **data}
            llm_cache.put(cache_key, {"form": form})
            return form
        except (APITimeoutError, APIConnectionError, RateLimitError) as e:
            last_err = e
            if attempt < _MAX_RETRIES - 1:
                time.sleep(_RETRY_BACKOFF[attempt])
                continue
            raise
        except Exception as e:
            last_err = e
            raise

    raise RuntimeError(f"ws generate-form 호출 실패: {last_err}")
