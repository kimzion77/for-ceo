"""노무제공자 계약서 (Service Provider Contract) 검토 모듈.

특수형태근로종사자(특고)·플랫폼 종사자 등 산재보험법 제125조 / 고용보험법 제77조의2
적용 노무제공자의 계약서를 검토.

cgr/ec/ 와 유사한 4단계 파이프라인:
  1. extract — 파일 → 텍스트 (OCR/파서 공유)
  2. structure — 텍스트 → 4섹션 16슬롯 JSON
  3. analyze — JSON + 컨텍스트 → 슬롯별 위반 분석
  4. (선택) generate — 표준 노무제공계약서 생성 (Phase 17 후속)
"""
from __future__ import annotations
