"""슬롯 카탈로그 엔드포인트.

GET    /api/v1/slots               : 전체 슬롯 목록 (필터 지원)
GET    /api/v1/slots/{slot_id}     : 슬롯 상세
PUT    /api/v1/slots/{slot_id}     : 슬롯 편집 (관리자)
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, status

from cgr.api.auth import require_admin_key, require_api_key
from cgr.api.schemas import SlotListOut, SlotOut, SlotUpdateIn, SlotUpdateOut
from cgr.web.admin.store import slot_writer


router = APIRouter(prefix="/slots", tags=["slots"])


def _to_slot_out(raw: dict) -> SlotOut:
    return SlotOut(
        slot_id=raw["slot_id"],
        article=raw.get("article", 0),
        parent_clause=raw.get("parent_clause"),
        required=raw.get("required", False),
        comparator=raw.get("comparator", ""),
        violation_severity=raw.get("violation_severity"),
        missing_severity=raw.get("missing_severity"),
        extract_target=raw.get("extract_target"),
        search_phrases=raw.get("search_phrases") or [],
        threshold_ok=raw.get("threshold_ok"),
        threshold_violation=raw.get("threshold_violation"),
        fix_example=raw.get("fix_example"),
        penalty=raw.get("penalty") or [],
        topic_meta=raw.get("topic_meta") or [],
    )


@router.get(
    "",
    response_model=SlotListOut,
    summary="슬롯 카탈로그 목록 조회",
    dependencies=[Depends(require_api_key)],
)
async def get_slots(
    comparator: str | None = Query(default=None, description="comparator 필터 (embed_match, >=, == 등)"),
    severity: str | None = Query(default=None, description="violation_severity 필터"),
    article: int | None = Query(default=None, description="조 번호 필터"),
    keyword: str | None = Query(default=None, description="slot_id·extract_target 키워드 검색"),
    limit: int = Query(default=200, ge=1, le=500),
) -> SlotListOut:
    parsed = slot_writer.load_raw()
    slots = parsed.get("slots") or []

    def _ok(s: dict) -> bool:
        if comparator and s.get("comparator") != comparator:
            return False
        if severity and s.get("violation_severity") != severity:
            return False
        if article is not None and s.get("article") != article:
            return False
        if keyword:
            kw = keyword.lower()
            hay = (s.get("slot_id", "") + " " + str(s.get("extract_target", ""))).lower()
            if kw not in hay:
                return False
        return True

    filtered = [s for s in slots if _ok(s)][:limit]
    return SlotListOut(
        total=len(filtered),
        slots=[_to_slot_out(s) for s in filtered],
    )


@router.get(
    "/{slot_id}",
    response_model=SlotOut,
    summary="슬롯 상세 조회",
    dependencies=[Depends(require_api_key)],
)
async def get_slot(slot_id: str) -> SlotOut:
    parsed = slot_writer.load_raw()
    for s in parsed.get("slots") or []:
        if s.get("slot_id") == slot_id:
            return _to_slot_out(s)
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"slot_id={slot_id} not found",
    )


@router.put(
    "/{slot_id}",
    response_model=SlotUpdateOut,
    summary="슬롯 편집 (관리자)",
    description=(
        "변경할 필드만 보내세요 (PATCH 스타일). "
        "저장 시 backups/<ts>_slot_edit_<slot_id>/ 에 자동 백업. "
        "검토 앱의 카탈로그 캐시도 자동 무효화."
    ),
    dependencies=[Depends(require_admin_key)],
)
async def put_slot(slot_id: str, patch: SlotUpdateIn) -> SlotUpdateOut:
    parsed = slot_writer.load_raw()
    idx = slot_writer.find_slot_index(parsed, slot_id)
    if idx < 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"slot_id={slot_id} not found",
        )
    new_slot = dict(parsed["slots"][idx])
    patch_dict = patch.model_dump(exclude_unset=True, exclude_none=True)
    new_slot.update(patch_dict)
    try:
        backup_dir = slot_writer.save_slot_edit(slot_id, new_slot)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"저장 실패: {type(e).__name__}: {e}",
        )
    return SlotUpdateOut(
        slot_id=slot_id,
        saved=True,
        backup_dir=str(backup_dir),
        message=f"{len(patch_dict)}개 필드 변경 — 다음 검토부터 반영",
    )
