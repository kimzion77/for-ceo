"""SC OCR/추출 텍스트 → 4 섹션·16 슬롯 JSON.

EC structure.py 와 동일한 패턴:
  - LLM JSON 강제 (response_format=json_object)
  - llm_cache 로 결정성 유지
  - PII 마스킹 게이트
  - 재시도 + 백오프
"""
from __future__ import annotations

import copy
import time
from typing import Any

from openai import APIConnectionError, APITimeoutError, OpenAI, RateLimitError

from .. import prompts
from ... import llm_cache
from ...config import get_api_key, get_llm_model
from ...pii_mask import mask_pii_text


_CALL_TIMEOUT = 60.0
_MAX_RETRIES = 3
_RETRY_BACKOFF = (2.0, 5.0, 10.0)


_EMPTY_STRUCTURE: dict[str, Any] = {
    "당사자정보": {
        "사업주": {"value": "", "note": ""},
        "노무제공자": {"value": "", "note": ""},
        "적용직종": {"value": "", "note": ""},
    },
    "계약기본": {
        "계약기간": {"value": "", "note": ""},
        "노무제공장소": {"value": "", "note": ""},
        "업무내용": {"value": "", "note": ""},
        "노무제공방식": {"value": "", "note": ""},
    },
    "보수및사회보험": {
        "보수": {"value": "", "note": ""},
        "보수지급일": {"value": "", "note": ""},
        "산재보험": {"value": "", "note": ""},
        "고용보험": {"value": "", "note": ""},
    },
    "보호및분쟁": {
        "안전보건의무": {"value": "", "note": ""},
        "계약해지": {"value": "", "note": ""},
        "손해배상책임": {"value": "", "note": ""},
        "분쟁해결": {"value": "", "note": ""},
        "근로자성위장방지": {"value": "", "note": ""},
    },
    "기타사항": [],
}


def empty_structure() -> dict[str, Any]:
    return copy.deepcopy(_EMPTY_STRUCTURE)


def run(extracted_text: str, *, model: str | None = None) -> dict[str, Any]:
    if not extracted_text or not extracted_text.strip():
        return empty_structure()

    extracted_text = mask_pii_text(extracted_text)

    model_name = get_llm_model(model)
    from cgr import prompt_store

    sys_prompt = prompt_store.get_or_default("sc_structure", prompts.STRUCTURE_PROMPT)
    user_prompt = prompts.build_structure_user_prompt(extracted_text)

    cache_key = llm_cache.make_key(
        system=sys_prompt,
        user=user_prompt,
        schema={"kind": "sc_structure"},
        model=model_name,
    )
    cached = llm_cache.get(cache_key)
    if cached is not None and isinstance(cached.get("structured"), dict):
        return cached["structured"]

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
            if not isinstance(data, dict):
                raise RuntimeError(f"SC structure 응답이 JSON object 가 아닙니다: {raw[:200]}")
            llm_cache.put(cache_key, {"structured": data})
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

    raise RuntimeError(f"SC structure 호출 실패: {last_err}")
