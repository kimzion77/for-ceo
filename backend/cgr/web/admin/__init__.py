"""관리자 대시보드 패키지.

검토 앱(`streamlit_app.py`)과 분리된 별도 Streamlit 앱.
포트 8502 에서 실행. 비밀번호 인증 필수.

구성:
  - admin_app.py        : 메인 진입 + 인증 + 랜딩 KPI
  - auth.py             : 비밀번호 검증·세션 가드·잠금
  - ui_common.py        : 공통 헤더·diff 렌더·KPI 카드
  - store/              : 영속화 계층 (slot_writer, history, settings_store)
  - pages/              : 4개 관리 페이지 (Streamlit 멀티페이지)
"""
