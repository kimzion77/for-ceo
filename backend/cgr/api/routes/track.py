"""익명 방문 추적 — POST /api/v1/track.

프론트(VisitPing)가 페이지 로드 시 fire-and-forget 으로 호출. 방문수·DAU/WAU/MAU
집계용. 방문자 식별자(visitor)는 프론트 localStorage 의 익명 uuid 또는 서버측
IP+UA 해시 — **개인정보(원시 IP·이름 등)는 저장하지 않는다.**

일반 API 키로 보호(BFF 가 자동 주입). 관리자 전용 아님.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from cgr.api.auth import require_api_key
from cgr.upload_tracker import anon_visitor
from cgr.web.admin.store import analytics


router = APIRouter(tags=["track"])


class TrackIn(BaseModel):
    visitor: str | None = None
    page: str | None = None
    service: str | None = None


@router.post("/track", summary="익명 방문 핑", dependencies=[Depends(require_api_key)])
async def post_track(body: TrackIn, request: Request) -> dict:
    visitor = (body.visitor or "").strip()[:64] or anon_visitor(request)
    analytics.log_visit(visitor, body.page, body.service)
    return {"ok": True}
