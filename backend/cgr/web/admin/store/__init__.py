"""관리자 대시보드 영속화 계층.

- slot_writer    : 슬롯 카탈로그 YAML 저장 + 자동 백업 + lru_cache 무효화
- history        : 검토 이력 JSONL append/read/필터
- settings_store : admin_settings.json R/W
"""
