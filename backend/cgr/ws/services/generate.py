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
