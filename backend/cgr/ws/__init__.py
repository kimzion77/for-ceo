"""임금명세서(wage statement) 검토 모듈.

문서 한 통의 11개 필수 기재 항목을 슬롯 단위로 정합성 검토.

원칙
- 슬롯·법령·주제 매핑은 모두 마스터 DB(SQLite) 에서 조회 — JSON/YAML fallback 없음.
- LLM 은 항목별 본문 추출만 담당. 판정·위험도 산출은 코드 룰.
- 결정성 최상위 — 같은 입력 → 같은 출력.

레이어
  catalog.py — 마스터 DB 에서 슬롯 로드 (Pydantic 모델)
  services/  — 단계별 처리 (extract / analyze)
"""
