"""근로계약서 풀 이식 — LLM 서비스 (structure / analyze / generate).

기존 `1. 근로계약서/기존/server/services/openaiService.js` 의 4함수를 Python 으로 옮긴 것.
- `structure.run(text)`        — OCR 텍스트 → 8섹션 JSON
- `analyze.run(data, ctx, guidelines)` — JSON + 사용자 컨텍스트 → 33매핑 분석 결과
- `generate.run(analysis)`     — 분석 결과 → 표준 근로계약서 텍스트

각 서비스는 동일한 정책을 공유한다:
- temperature=0, top_p=1 (결정성)
- 같은 입력 → llm_cache 히트 → LLM 호출 0회
- 재시도 3회 (2s, 5s, 10s 백오프)
"""
from . import analyze, chat, generate, structure

__all__ = ["analyze", "chat", "generate", "structure"]
