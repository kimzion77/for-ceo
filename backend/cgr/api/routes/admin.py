"""관리자 전용 API — 캐시·설정·통계.

GET    /api/v1/admin/cache           : LLM 캐시 통계
DELETE /api/v1/admin/cache           : LLM 캐시 전체 비우기
GET    /api/v1/admin/settings        : 시스템 설정 (임계값·모델·DB 버전)
PUT    /api/v1/admin/settings        : 설정 변경
GET    /api/v1/admin/stats           : 종합 통계 (슬롯·캐시·이력)
"""
from __future__ import annotations

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
from cgr.web.admin.store import analytics, history, settings_store, slot_writer


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
        except Exception:
            pass
        try:
            from cgr.catalog import _load_cached
            _load_cached.cache_clear()
        except Exception:
            pass

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
    except Exception:
        pass

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
    summary="업로드 파일 열람 (이미지 인라인)",
    dependencies=[Depends(require_admin_key)],
)
async def get_upload_file(uid: int):
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
    media = rec.get("mime") or "application/octet-stream"
    return FileResponse(str(p), media_type=media, filename=rec.get("filename") or p.name)


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
