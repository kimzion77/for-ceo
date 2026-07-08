"""운영 데이터 영속화 계층 (구 cgr.web.admin.store 에서 분리).

API·코어가 Streamlit 레거시(web/)에 의존하지 않도록 승격된 패키지.
- analytics      : events.db — 방문·업로드·상호작용 로그
- history        : 검토 이력 JSONL append/read/필터
- access_log     : 접근 로그
- slot_writer    : 슬롯 카탈로그 YAML 저장 + 자동 백업 + lru_cache 무효화
- prompt_writer  : 프롬프트 파일 저장
- settings_store : admin_settings.json R/W
"""
