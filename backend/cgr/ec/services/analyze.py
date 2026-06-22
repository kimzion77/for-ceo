"""근로계약서 33-매핑 위반 분석 (LLM).

기존 `server/services/openaiService.js#performLegalAnalysis` 를 옮긴 것.
- system: ANALYSIS_PROMPT (33-매핑 테이블 + meta 태그 지시 포함)
- user:   build_analyze_user_prompt(structured_data, business_size, worker_types, legal_guidelines)
- 출력: 33매핑 검토 결과 dict

출력 JSON 스키마(기존과 동일):
```
{
  "riskLevel": "상/중/하",
  "overallStatus": "위험/보완필요/적정",
  "overallOpinion": "전반적인 검토 결과 총평",
  "results": [
    {
      "항목": str,
      "적용조건": "공통/5인이상/...",
      "서면명시의무": str,
      "적절성": "적절/부적절/보완필요",
      "판단이유": str  // <meta db='...' n='...' /> 태그 포함
      "발견내용": str,
      "법적근거": str,
      "개선권고": str,
    }
  ],
  "finalRecommendations": str,
}
```
"""
from __future__ import annotations

import re
import time
from typing import Any

from openai import APIConnectionError, APITimeoutError, OpenAI, RateLimitError

from .. import prompts
from ..topic_lookup import topics_for_item
from ... import llm_cache
from ...config import get_api_key, get_llm_model
from ...pii_mask import mask_pii_in_payload


_CALL_TIMEOUT = 120.0  # 분석은 출력 길어서 여유 있게

_META_RE = re.compile(r"<meta\b[^>]*?>", re.IGNORECASE)


def _attach_real_topic_refs(data: dict[str, Any]) -> dict[str, Any]:
    """LLM 이 판단이유에 넣은 <meta> 태그(부정확·환각: 'DB_xxx 1.1' 같은 placeholder)를
    제거하고, 각 항목의 **DB 실제 연관주제**(check_item_topic 조인)로 교체한다.
    → '참고 자료' 칩이 항상 정확한 주제·섹션을 가리킨다(결정적). idempotent."""
    try:
        results = data.get("results")
        if not isinstance(results, list):
            return data
        for item in results:
            if not isinstance(item, dict):
                continue
            field = (item.get("항목") or "").strip()
            reason = _META_RE.sub("", item.get("판단이유") or "")
            reason = re.sub(r"\s{2,}", " ", reason).strip()
            refs = (topics_for_item(field) if field else [])[:4]  # 칩 과다 방지
            metas = "".join(
                f"<meta db='DB_{topic}' n='{sec}' />" for topic, sec in refs
            )
            item["판단이유"] = (reason + (" " + metas if metas else "")).strip()
    except Exception:
        pass
    return data
_MAX_RETRIES = 3
_RETRY_BACKOFF = (2.0, 5.0, 10.0)


_FALLBACK_RESULT: dict[str, Any] = {
    "riskLevel": "중",
    "overallStatus": "보완필요",
    "overallOpinion": "분석 중 오류가 발생했습니다.",
    "results": [],
    "finalRecommendations": "시스템 오류로 인해 분석을 완료하지 못했습니다. 다시 시도해주세요.",
}


def run(
    structured_data: dict[str, Any],
    business_size: str,
    worker_types: list[str],
    *,
    legal_guidelines: str = "",
    model: str | None = None,
) -> dict[str, Any]:
    """구조화된 근로계약서 + 사용자 컨텍스트 → 위반 분석 결과 dict.

    `legal_guidelines` 는 기존 RAG 검색 결과 자리. 풀 이식 1단계는 빈 문자열로 가고,
    이후 단계에서 슬롯·주제 임베딩 매칭으로 채울 예정.
    """
    if not isinstance(structured_data, dict):
        raise ValueError("structured_data 가 dict 가 아닙니다.")

    # PII 비식별 게이트 — 8섹션 중첩 dict 모든 string 값 마스킹
    structured_data = mask_pii_in_payload(structured_data)

    model_name = get_llm_model(model)
    sys_prompt = prompts.get_analysis_prompt()
    user_prompt = prompts.build_analyze_user_prompt(
        structured_data=structured_data,
        business_size=business_size or "",
        worker_types=worker_types or [],
        legal_guidelines=legal_guidelines or "",
    )

    cache_key = llm_cache.make_key(
        system=sys_prompt,
        user=user_prompt,
        schema={"kind": "ec_analyze"},
        model=model_name,
    )
    cached = llm_cache.get(cache_key)
    if cached is not None and isinstance(cached.get("analysis"), dict):
        # 구 캐시(부정확 meta)도 실제 참고자료로 교정해 반환 (idempotent)
        return _attach_real_topic_refs(cached["analysis"])

    client = OpenAI(api_key=get_api_key(), timeout=_CALL_TIMEOUT)
    last_err: Exception | None = None

    for attempt in range(_MAX_RETRIES):
        try:
            # 주의: max_tokens 를 지정하지 말 것 — gpt-5.x 계열은 이 파라미터를
            # 거부함(max_completion_tokens 사용). 미지정 시 모델 기본 최대치 사용.
            # truncation 은 비동기 잡(게이트웨이 타임아웃 우회)으로 이미 해결됨.
            resp = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0,
                top_p=1,
                # gpt-5.x 출력 장황함 축소 — 33항목 JSON 생성 시간을 ~15-20% 단축.
                # 스키마/판단은 유지하고 산문만 간결화(측정: 4778→3767 토큰).
                verbosity="low",
            )
            raw = resp.choices[0].message.content or ""
            data = prompts.safe_json_parse(raw, default=None)
            if not isinstance(data, dict) or "results" not in data:
                raise RuntimeError(
                    f"analyze 응답 형식이 올바르지 않습니다: {raw[:200]}"
                )
            # 참고 자료 = LLM <meta> 대신 DB 실제 연관주제로 교체 (정확성·결정성)
            data = _attach_real_topic_refs(data)
            # 캐시 저장 — 같은 입력 → 같은 결과 (결정성)
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

    raise RuntimeError(f"analyze 호출 실패: {last_err}")


def fallback_result() -> dict[str, Any]:
    """LLM 미가용 등 비상 fallback. 호출자가 명시적으로 사용해야 한다."""
    import copy
    return copy.deepcopy(_FALLBACK_RESULT)
