"""취업규칙 검토 AI — FastAPI 백엔드 진입점.

실행:
    python launch_api.py
    # 또는
    uvicorn cgr.api.main:app --port 8503 --host 127.0.0.1

OpenAPI 문서: http://127.0.0.1:8503/docs (Swagger UI)
              http://127.0.0.1:8503/redoc (ReDoc)
"""
from __future__ import annotations

import sys
from pathlib import Path

# cgr 패키지 import 보장
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from cgr.api.routes import admin, ec, guide, history, master_db, review, sc, slots, topics, track, wr_classify, ws
from cgr.api.schemas import HealthResponse


app = FastAPI(
    title="취업규칙 검토 AI API",
    description=(
        "감독관 검토 앱(Streamlit 8501)과 관리자 대시보드(Streamlit 8502)의 백엔드 REST API.\n\n"
        "**인증**: 모든 보호 엔드포인트는 `X-API-Key` 헤더 필요.\n\n"
        "**핵심 엔드포인트**:\n"
        "- `POST /api/v1/review` — 사업장 파일 업로드 + 검토 실행\n"
        "- `GET /api/v1/slots` — 슬롯 카탈로그 조회 (필터)\n"
        "- `GET /api/v1/master-db/articles/{no}` — 마스터 DB 조 상세\n"
        "- `GET /api/v1/history` — 검토 이력\n\n"
        "**관리자 엔드포인트** (PUT/DELETE 류 + ADMIN_API_KEY 필요):\n"
        "- `PUT /api/v1/slots/{slot_id}` — 슬롯 편집\n"
        "- `PUT /api/v1/admin/settings` — 시스템 설정 변경\n"
        "- `DELETE /api/v1/admin/cache` — LLM 캐시 비우기\n\n"
        "Streamlit 앱과 동일한 슬롯·마스터·이력 데이터를 공유합니다."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)


# ─── CORS — 개발용 개방 (운영 시 origins 제한 권장) ─
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 운영 시 ["https://your-frontend.com"] 로 제한
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Process-Time"],
)

# ─── gzip 응답 압축 — 분석 결과 등 큰 JSON 응답을 60-70% 줄여 전송 시간 단축 ───
# minimum_size: 이보다 작은 응답은 압축 오버헤드만 들어서 패스. 1KB 가 합리적 임계.
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=5)


# ─── 라우터 등록 (prefix /api/v1) ──────────
API_PREFIX = "/api/v1"
app.include_router(review.router, prefix=API_PREFIX)
app.include_router(wr_classify.router, prefix=API_PREFIX)
app.include_router(ec.router, prefix=API_PREFIX)
app.include_router(slots.router, prefix=API_PREFIX)
app.include_router(master_db.router, prefix=API_PREFIX)
app.include_router(history.router, prefix=API_PREFIX)
app.include_router(admin.router, prefix=API_PREFIX)
app.include_router(topics.router, prefix=API_PREFIX)
app.include_router(ws.router, prefix=API_PREFIX)
app.include_router(sc.router, prefix=API_PREFIX)
app.include_router(guide.router, prefix=API_PREFIX)
app.include_router(track.router, prefix=API_PREFIX)


# ─── startup 유지보수 — 업로드 보관기간 정리(배포/재시작 시 1회) ───
@app.on_event("startup")
async def _startup_maintenance() -> None:
    try:
        from cgr.web.admin.store import analytics, settings_store

        days = int(settings_store.get("upload_retention_days", 30) or 30)
        analytics.cleanup_old_uploads(days)
    except Exception:
        pass


# ─── 헬스 체크 (인증 불요) ──────────────────
@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["health"],
    summary="헬스 체크 (인증 불필요)",
)
async def health() -> HealthResponse:
    """서비스 상태 확인. 인증 없이 호출 가능 — 로드밸런서·모니터링용."""
    services = {}
    try:
        from cgr.master_db import _resolve_path
        services["master_db"] = str(_resolve_path().name)
    except Exception as e:
        services["master_db"] = f"error: {e}"
    try:
        from cgr.web.admin.store import slot_writer
        parsed = slot_writer.load_raw()
        services["slots"] = f"{len(parsed.get('slots') or [])}개"
    except Exception as e:
        services["slots"] = f"error: {e}"
    try:
        from cgr import llm_cache
        s = llm_cache.stats()
        services["llm_cache"] = f"{s.get('entries', 0)}개"
    except Exception as e:
        services["llm_cache"] = f"error: {e}"

    return HealthResponse(status="ok", version="1.0.0", services=services)


# ─── Warm-up — Render 무료 sleep 방지용 초경량 ping ────────
# 인증 불필요 + 즉시 응답. BFF 경유(`/api/cgr/warmup`)로 호출 가능하게 API_PREFIX 안에 둠.
# UptimeRobot, 프론트 진입 시 fire-and-forget 핑 등에서 사용.
@app.get(
    f"{API_PREFIX}/warmup",
    tags=["health"],
    summary="warm-up (초경량 ping)",
    include_in_schema=False,
)
async def warmup() -> dict[str, str]:
    return {"status": "warm"}


@app.get("/", include_in_schema=False)
async def root():
    """루트 — 문서 페이지로 안내."""
    return {
        "service": "취업규칙 검토 AI API",
        "version": "1.0.0",
        "docs": "/docs",
        "redoc": "/redoc",
        "health": "/health",
    }
