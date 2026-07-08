"""API 스모크 테스트 — 앱 기동·인증 게이트·헬스.

LLM 을 호출하지 않는 경로만 검증한다:
  - 앱이 import·기동되는가 (라우터 12개 등록 포함)
  - 보호 엔드포인트가 키 없이는 401 인가 (인증 게이트 보증)
  - 관리자 엔드포인트가 일반 키로는 거부되는가
"""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    # conftest 가 API_KEY/ADMIN_API_KEY/CGR_DATA_DIR(임시) 를 이미 설정한 상태에서 import
    from cgr.api.main import app
    with TestClient(app) as c:  # with: startup 이벤트(보관기간 정리 — 임시 디렉터리) 실행
        yield c


API = "/api/v1"
KEY = {"X-API-Key": os.environ.get("API_KEY", "test-api-key")}
ADMIN = {"X-API-Key": os.environ.get("ADMIN_API_KEY", "test-admin-key")}


def test_health_no_auth(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_warmup_no_auth(client):
    r = client.get(f"{API}/warmup")
    assert r.status_code == 200
    assert r.json() == {"status": "warm"}


def test_security_headers_present(client):
    r = client.get("/health")
    assert r.headers.get("X-Content-Type-Options") == "nosniff"
    assert r.headers.get("X-Frame-Options") == "SAMEORIGIN"


def test_protected_route_requires_key(client):
    assert client.get(f"{API}/slots").status_code == 401
    assert client.get(f"{API}/slots", headers={"X-API-Key": "wrong"}).status_code == 401


def test_protected_route_with_key(client):
    r = client.get(f"{API}/slots", headers=KEY)
    assert r.status_code == 200


def test_admin_route_rejects_general_key(client):
    r = client.get(f"{API}/admin/analytics", headers=KEY)
    assert r.status_code == 401  # 일반 키 ≠ 관리자 키


def test_admin_route_with_admin_key(client):
    r = client.get(f"{API}/admin/analytics", headers=ADMIN)
    assert r.status_code == 200
    body = r.json()
    assert "total_visits" in body


def test_upload_rejects_disguised_file(client):
    """추출 엔드포인트가 위장 파일(.png 인데 exe 바이트)을 400 으로 거부."""
    r = client.post(
        f"{API}/ws/extract/start",
        headers=KEY,
        files={"file": ("fake.png", b"MZ\x90\x00" + b"\x00" * 32, "image/png")},
    )
    assert r.status_code == 400
