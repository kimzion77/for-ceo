"""테스트 공통 픽스처 — 운영 데이터·외부 API 완전 격리.

원칙
- 외부 LLM 호출 금지: 여기 테스트는 결정적 코드 경로(룰엔진·판정·마스킹·검증)만 다룬다.
- 운영 데이터 오염 금지: 가변 데이터(events.db·uploads·prompts)는 임시 디렉터리로.
- 마스터 DB(backend/data/master.db)는 읽기 전용 ground-truth 로 그대로 사용 —
  룰의 기준값(최저임금·위반 메타)이 실제 배포본과 같은지도 함께 검증되는 효과.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]

# cgr import 보장 (pytest.ini pythonpath=. 와 이중 안전망)
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def pytest_configure(config):
    """cgr 모듈 import 전에 환경 격리 — 세션 전체 적용."""
    tmp = Path(config.cache.mkdir("cgr_data"))  # pytest 관리 임시 디렉터리
    os.environ["CGR_DATA_DIR"] = str(tmp)        # events.db·uploads·prompts → 임시
    os.environ["CGR_DISABLE_CACHE"] = "1"        # LLM 캐시 디스크 쓰기 금지
    os.environ.setdefault("API_KEY", "test-api-key")
    os.environ.setdefault("ADMIN_API_KEY", "test-admin-key")
    # OPENAI 키는 없어도 됨 — LLM 경로는 테스트하지 않음. 실수 호출 시 즉시 실패하도록 무효값.
    os.environ.setdefault("OPENAI_API_KEY", "test-not-a-real-key")


@pytest.fixture()
def master_db_available() -> bool:
    """마스터 DB 존재 여부 — 없으면 해당 테스트 skip."""
    db_path = BACKEND_ROOT / "data" / "master.db"
    if not db_path.exists():
        pytest.skip("backend/data/master.db 없음 — 룰 기준값 테스트 skip")
    return True
