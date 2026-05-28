"""FastAPI 백엔드 패키지.

검토 AI 시스템의 REST API. 외부 프론트엔드(React/Next/Vue 등)가 호출.
포트 8503. prefix `/api/v1`. 인증: X-API-Key 헤더.

엔드포인트 그룹:
  - review     : 검토 실행·결과 조회 (감독관용 핵심 API)
  - slots      : 슬롯 카탈로그 조회·편집 (관리자)
  - master_db  : 표준취업규칙 마스터 DB 조회
  - history    : 검토 이력 조회·통계
  - cache      : LLM 캐시 통계·정리 (관리자)
  - settings   : 시스템 설정 (관리자)
"""
__all__ = []
