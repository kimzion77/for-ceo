"""SC 구조화 데이터 + 컨텍스트 → 16 슬롯 위반 분석.

EC analyze.py 와 동일 패턴, 슬롯 카탈로그·금지 표현은 prompts.py 가 동적 인라인.
"""
from __future__ import annotations

import time
from typing import Any

from openai import APIConnectionError, APITimeoutError, OpenAI, RateLimitError

from .. import prompts
from ... import llm_cache
from ...config import get_api_key, get_llm_model
from ...pii_mask import mask_pii_in_payload


_CALL_TIMEOUT = 120.0
_MAX_RETRIES = 3
_RETRY_BACKOFF = (2.0, 5.0, 10.0)


def run(
    structured_data: dict[str, Any],
    *,
    worker_subtype: str = "",
    business_size: str = "",
    model: str | None = None,
) -> dict[str, Any]:
    if not isinstance(structured_data, dict):
        raise ValueError("structured_data 가 dict 가 아닙니다.")

    # PII 마스킹
    structured_data = mask_pii_in_payload(structured_data)

    model_name = get_llm_model(model)
    sys_prompt = prompts.get_analysis_prompt()
    user_prompt = prompts.build_analyze_user_prompt(
        structured_data,
        worker_subtype=worker_subtype,
        business_size=business_size,
    )

    cache_key = llm_cache.make_key(
        system=sys_prompt,
        user=user_prompt,
        schema={"kind": "sc_analyze"},
        model=model_name,
    )
    cached = llm_cache.get(cache_key)
    if cached is not None and isinstance(cached.get("analysis"), dict):
        return cached["analysis"]

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
            data = prompts.safe_json_parse(raw, default=None)
            if not isinstance(data, dict) or "results" not in data:
                raise RuntimeError(f"SC analyze 응답 형식이 올바르지 않습니다: {raw[:200]}")
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

    raise RuntimeError(f"SC analyze 호출 실패: {last_err}")
