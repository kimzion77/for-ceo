"""임금명세서 1차 분류 (LLM) — 계약 유형 자동 판별.

근로계약서(근로자 유형)·취업규칙(근로환경)과 동일한 UX 철학: 사용자가 홈에서
직접 고르는 대신, AI 가 임금명세서 텍스트를 읽고 계약 유형을 먼저 추정하고,
2차 분석 직전에 '맞아요/아니에요'로 확인만 하게 한다.

출력 스키마:
```
{
  "contract_type": "기간제",          # 정규직 / 기간제 / 단시간 / 일용직 중 하나
  "doc_kind": "기간제 임금명세서",     # 사용자에게 보여줄 한 줄 명칭
  "reason": "근로계약기간이 명시되어 ..."
}
```
"""
from __future__ import annotations

import json
import time
from typing import Any

from openai import APIConnectionError, APITimeoutError, OpenAI, RateLimitError

from . import llm_cache
from .config import get_api_key, get_llm_model
from .ec import prompts
from .pii_mask import mask_pii_in_payload

_CALL_TIMEOUT = 60.0
_MAX_RETRIES = 3
_RETRY_BACKOFF = (2.0, 5.0, 10.0)

# 프론트 WS_CONTRACT_TYPES 와 1:1 — 변경 시 양쪽 함께.
ALLOWED_TYPES = ["정규직", "기간제", "단시간", "일용직"]
ALLOWED_CYCLES = ["월급", "시급", "일급"]

_SYSTEM = (
    "너는 한국 노동법 임금명세서 분석 전문가다. 입력된 임금명세서(또는 급여명세)\n"
    "텍스트를 읽고 아래 항목을 추출·판별해 JSON 으로만 답한다.\n\n"
    "1) contract_type — 계약 유형 (이 중 정확히 하나):\n"
    f"   {', '.join(ALLOWED_TYPES)}\n"
    "   - 일용직: 일 단위 고용·일당·'일용' 표기, 근무일수×일당 형태의 지급\n"
    "   - 단시간: 1주 소정근로시간이 통상(40시간)보다 짧음, 시급제 파트타임,\n"
    "     '단시간'·'아르바이트' 표기\n"
    "   - 기간제: 계약기간 종료일이 명시되거나 '계약직'·'기간제' 표기\n"
    "   - 위 단서가 없으면 정규직 (월급제 상용직)\n\n"
    "2) pay_period_year, pay_period_month — 이 명세서가 '어느 시점 임금'에 대한\n"
    "   것인지(임금 산정·귀속 기간). 예: '2025년 3월분 급여' → year=2025, month=3.\n"
    "   '2025-03', '2025.3월' 같은 표기도 해석. **명세서에 산정 기간이 적혀있지\n"
    "   않으면 추측하지 말고 둘 다 null** (지급일만 있고 산정월이 불분명하면 null).\n\n"
    "3) pay_cycle — 임금 지급 주기 (이 중 하나 또는 null):\n"
    f"   {', '.join(ALLOWED_CYCLES)}\n"
    "   - 월 단위 총액·'월급'·기본급(월) → 월급\n"
    "   - 시급 단가×시간 구조·'시급' → 시급 / 일당×일수·'일급' → 일급\n"
    "   - 단서가 전혀 없으면 null\n\n"
    "4) weekly_hours — 명세서에 '주 소정근로시간'이 숫자로 적혀 있으면 그 값,\n"
    "   없으면 null (단시간 시급 환산용, 대개 비어 있음).\n\n"
    "중요: 적혀 있지 않은 값을 지어내지 말 것 — 없으면 null. 누락 자체는 뒤\n"
    "분석 단계에서 '필수 기재사항 누락' 으로 잡는다.\n\n"
    "출력 JSON 스키마 (이 키만):\n"
    '{"contract_type": "...", "pay_period_year": 2025 또는 null, '
    '"pay_period_month": 3 또는 null, "pay_cycle": "월급" 또는 null, '
    '"weekly_hours": 40 또는 null, '
    '"doc_kind": "사용자에게 보여줄 한 줄 명칭 (예: 기간제 임금명세서)", '
    '"reason": "판단 근거 1~2문장 (사장님이 읽을 쉬운 한국어)"}'
)


def _to_int_or_none(v: Any, *, lo: int, hi: int) -> int | None:
    """정수 변환 + 범위 검증. 범위 밖·파싱 실패 → None."""
    try:
        n = int(str(v).strip())
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def run(extracted_text: str, *, model: str | None = None) -> dict[str, Any]:
    """임금명세서 텍스트 → {contract_type, doc_kind, reason}. 실패 시 raise."""
    text = (extracted_text or "").strip()
    if not text:
        raise ValueError("분류할 텍스트가 비어 있습니다.")

    masked = mask_pii_in_payload({"t": text[:6000]})["t"]
    user_prompt = f"[임금명세서 텍스트]\n{masked}"

    model_name = get_llm_model(model)
    cache_key = llm_cache.make_key(
        system=_SYSTEM,
        user=user_prompt,
        schema={"kind": "ws_classify"},
        model=model_name,
    )
    cached = llm_cache.get(cache_key)
    if cached is not None and isinstance(cached.get("classify"), dict):
        return cached["classify"]

    client = OpenAI(api_key=get_api_key(), timeout=_CALL_TIMEOUT)
    last_err: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            resp = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": _SYSTEM},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0,
                top_p=1,
            )
            raw = resp.choices[0].message.content or ""
            data = prompts.safe_json_parse(raw, default=None)
            if not isinstance(data, dict):
                raise RuntimeError(f"ws classify 응답 형식 오류: {raw[:120]}")
            ctype = str(data.get("contract_type") or "").strip()
            if ctype not in ALLOWED_TYPES:
                ctype = "정규직"  # 허용목록 밖 → 보수적 기본값
            cycle = str(data.get("pay_cycle") or "").strip()
            if cycle not in ALLOWED_CYCLES:
                cycle = None  # 단서 없음 → null (분석 단계에서 누락 판정)
            out = {
                "contract_type": ctype,
                # 적혀있지 않으면 null — 누락은 분석에서 위반으로 잡는다.
                "pay_period_year": _to_int_or_none(
                    data.get("pay_period_year"), lo=2000, hi=2100
                ),
                "pay_period_month": _to_int_or_none(
                    data.get("pay_period_month"), lo=1, hi=12
                ),
                "pay_cycle": cycle,
                "weekly_hours": _to_int_or_none(
                    data.get("weekly_hours"), lo=1, hi=68
                ),
                "doc_kind": str(data.get("doc_kind") or "임금명세서").strip(),
                "reason": str(data.get("reason") or "").strip(),
            }
            llm_cache.put(cache_key, {"classify": out})
            return out
        except (APITimeoutError, APIConnectionError, RateLimitError) as e:
            last_err = e
            if attempt < _MAX_RETRIES - 1:
                time.sleep(_RETRY_BACKOFF[attempt])
                continue
            raise
        except json.JSONDecodeError as e:
            last_err = e
            raise
    raise RuntimeError(f"ws classify 호출 실패: {last_err}")
