"""관리자 전용 API — 캐시·설정·통계.

GET    /api/v1/admin/cache           : LLM 캐시 통계
DELETE /api/v1/admin/cache           : LLM 캐시 전체 비우기
GET    /api/v1/admin/settings        : 시스템 설정 (임계값·모델·DB 버전)
PUT    /api/v1/admin/settings        : 설정 변경
GET    /api/v1/admin/stats           : 종합 통계 (슬롯·캐시·이력)
"""
from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, Depends

from cgr import llm_cache
from cgr.api.auth import require_admin_key, require_api_key
from cgr.api.schemas import (
    CacheClearOut,
    CacheStatsOut,
    SettingsOut,
    SettingsUpdateIn,
    StatsOut,
)
from cgr.master_db import get_master_db
from cgr.web.admin.store import history, settings_store, slot_writer


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
