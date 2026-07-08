"""관리자 전용 API — 캐시·설정·통계.

GET    /api/v1/admin/cache           : LLM 캐시 통계
DELETE /api/v1/admin/cache           : LLM 캐시 전체 비우기
GET    /api/v1/admin/settings        : 시스템 설정 (임계값·모델·DB 버전)
PUT    /api/v1/admin/settings        : 설정 변경
GET    /api/v1/admin/stats           : 종합 통계 (슬롯·캐시·이력)
"""
from __future__ import annotations

import mimetypes
from collections import Counter
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from cgr import datadir, llm_cache, prompt_store
from cgr.api.auth import require_admin_key, require_api_key
from cgr.api.schemas import (
    CacheClearOut,
    CacheStatsOut,
    SettingsOut,
    SettingsUpdateIn,
    StatsOut,
)
from cgr.master_db import get_master_db
from cgr.store import analytics, history, settings_store, slot_writer


from cgr.log import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# ─── 캐시 ────────────────────────────────────
@router.get(
    "/cache",
    response_model=CacheStatsOut,
    summary="LLM 캐시 통계",
    dependencies=[Depends(require_api_key)],
)
async def get_cache_stats() -> CacheStatsOut:
    s = llm_cache.stats()
    return CacheStatsOut(entries=s.get("entries", 0), size_kb=s.get("size_kb", 0))


@router.delete(
    "/cache",
    response_model=CacheClearOut,
    summary="LLM 캐시 전체 비우기 (관리자)",
    dependencies=[Depends(require_admin_key)],
)
async def delete_cache() -> CacheClearOut:
    n = llm_cache.clear()
    return CacheClearOut(deleted=n)


# ─── 설정 ────────────────────────────────────
@router.get(
    "/settings",
    response_model=SettingsOut,
    summary="시스템 설정 조회",
    dependencies=[Depends(require_api_key)],
)
async def get_settings() -> SettingsOut:
    s = settings_store.load()
    return SettingsOut(
        embed_threshold_ok=float(s.get("embed_threshold_ok", 0.50)),
        embed_threshold_violation=float(s.get("embed_threshold_violation", 0.48)),
        prefilter_threshold=float(s.get("prefilter_threshold", 0.30)),
        llm_model=s.get("llm_model", ""),
        embed_model=s.get("embed_model", ""),
        master_db_version=s.get("master_db_version", ""),
        default_workplace=s.get("default_workplace") or {},
    )


@router.put(
    "/settings",
    response_model=SettingsOut,
    summary="시스템 설정 변경 (관리자)",
    dependencies=[Depends(require_admin_key)],
)
async def put_settings(patch: SettingsUpdateIn) -> SettingsOut:
    patch_dict = patch.model_dump(exclude_unset=True, exclude_none=True)
    if patch_dict:
        settings_store.update(patch_dict)
        # 마스터 DB 버전 변경 시 캐시 무효화
        try:
            from cgr.master_db import get_master_db as _get
            _get.cache_clear()
        except Exception as e:
            log.warning("무시된 예외 — %s: %s", type(e).__name__, e)
        try:
            from cgr.catalog import _load_cached
            _load_cached.cache_clear()
        except Exception as e:
            log.warning("무시된 예외 — %s: %s", type(e).__name__, e)

    return await get_settings()


# ─── 종합 통계 ──────────────────────────────
@router.get(
    "/stats",
    response_model=StatsOut,
    summary="종합 통계 (슬롯·마스터·이력·캐시)",
    dependencies=[Depends(require_api_key)],
)
async def get_admin_stats() -> StatsOut:
    parsed = slot_writer.load_raw()
    slots = parsed.get("slots") or []

    comp = Counter(s.get("comparator", "") for s in slots)
    sev = Counter(s.get("violation_severity") or "(미지정)" for s in slots)

    n_articles = 0
    try:
        db = get_master_db()
        n_articles = len(db.all_articles())
    except Exception as e:
        log.warning("무시된 예외 — %s: %s", type(e).__name__, e)

    hist_rows = history.read_history()
    cache_stats = llm_cache.stats()

    return StatsOut(
        n_slots=len(slots),
        comparator_dist=dict(comp),
        severity_dist=dict(sev),
        n_articles=n_articles,
        n_reviews=len(hist_rows),
        n_cache=cache_stats.get("entries", 0),
    )


# ─── 사용량 분석 (대시보드) ──────────────────
@router.get(
    "/analytics",
    summary="사용량 통계 — 방문수·DAU/WAU/MAU·업로드",
    dependencies=[Depends(require_admin_key)],
)
async def get_analytics() -> dict:
    return analytics.analytics_summary()


# ─── 업로드 기록 ────────────────────────────
@router.get(
    "/uploads",
    summary="업로드 기록 목록 (익명)",
    dependencies=[Depends(require_admin_key)],
)
async def get_uploads(
    limit: int = 100, offset: int = 0, service: str | None = None
) -> dict:
    rows, total = analytics.list_uploads(
        limit=min(max(limit, 1), 500), offset=max(offset, 0), service=service
    )
    for r in rows:
        sp = r.pop("stored_path", "") or ""
        r["has_file"] = bool(sp and Path(sp).exists())
    return {"items": rows, "total": total}


@router.get(
    "/uploads/{uid}/file",
    summary="업로드 파일 열람(인라인) / 다운로드(?download=1)",
    dependencies=[Depends(require_admin_key)],
)
async def get_upload_file(uid: int, download: bool = False):
    rec = analytics.get_upload(uid)
    if not rec or not rec.get("stored_path"):
        raise HTTPException(status_code=404, detail="파일 기록이 없습니다.")
    p = Path(rec["stored_path"])
    # 경로 가드 — uploads_dir 하위만 허용
    try:
        p.resolve().relative_to(datadir.uploads_dir().resolve())
    except Exception:
        raise HTTPException(status_code=403, detail="허용되지 않은 경로.")
    if not p.exists():
        raise HTTPException(status_code=404, detail="파일이 삭제되었습니다(보관기간 만료).")
    # ★보안: content-type 은 **서버측 확장자**로 결정한다(클라이언트가 업로드 때 보낸 mime
    #  은 신뢰하지 않음). 안 그러면 .png 확장자에 text/html mime+HTML 본문을 올려 inline 으로
    #  열면 프론트 오리진에서 스크립트가 실행되는 저장형 XSS 가 가능. (+ 전역 nosniff)
    media = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    # inline 은 브라우저가 스크립트를 실행하지 않는 형식(이미지·PDF)만 허용. 그 외(.txt/.docx/
    #  .hwp 등)는 download 여부와 무관하게 첨부로 내려보내 인라인 렌더링 자체를 차단.
    safe_inline = media.startswith("image/") or media == "application/pdf"
    as_attachment = download or not safe_inline
    return FileResponse(
        str(p),
        media_type=media,
        filename=(rec.get("filename") or p.name) if as_attachment else None,
        content_disposition_type="attachment" if as_attachment else "inline",
    )


# ─── 프롬프트 편집 (즉시 적용) ────────────────
class PromptSaveIn(BaseModel):
    key: str
    content: str


@router.get(
    "/prompts",
    summary="편집형 프롬프트 목록 + 현재 내용",
    dependencies=[Depends(require_admin_key)],
)
async def get_prompts() -> dict:
    return {"prompts": prompt_store.list_prompts(include_content=True)}


@router.put(
    "/prompts",
    summary="프롬프트 저장 (저장 즉시 적용)",
    dependencies=[Depends(require_admin_key)],
)
async def put_prompt(body: PromptSaveIn) -> dict:
    ok = prompt_store.save_prompt(body.key, body.content)
    if not ok:
        raise HTTPException(status_code=404, detail=f"알 수 없는 프롬프트 키: {body.key}")
    return {"ok": True, "key": body.key}


# ─── 상호작용 로그 (챗봇·검토 Input/Output) ───
@router.get(
    "/logs",
    summary="상호작용 로그 목록 (챗봇·근로계약서·임금명세서·취업규칙)",
    dependencies=[Depends(require_admin_key)],
)
async def get_logs(limit: int = 100, offset: int = 0, kind: str | None = None) -> dict:
    rows, total = analytics.list_interactions(
        limit=min(max(limit, 1), 500), offset=max(offset, 0), kind=kind
    )
    return {"items": rows, "total": total}


@router.get(
    "/logs/{lid}",
    summary="상호작용 로그 상세 (전체 Input/Output)",
    dependencies=[Depends(require_admin_key)],
)
async def get_log(lid: int) -> dict:
    rec = analytics.get_interaction(lid)
    if not rec:
        raise HTTPException(status_code=404, detail="로그가 없습니다.")
    return rec
