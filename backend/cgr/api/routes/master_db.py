"""표준취업규칙 마스터 DB 조회 (read-only).

GET /api/v1/master-db/articles            : 98개 조 간략 목록
GET /api/v1/master-db/articles/{no}       : 조 상세 (본문·벌칙·법령 등)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from cgr.api.auth import require_api_key
from cgr.api.schemas import ArticleListOut, ArticleOut
from cgr.master_db import _resolve_path, get_master_db
from cgr.penalty_parser import format_for_user


router = APIRouter(prefix="/master-db", tags=["master_db"])


@router.get(
    "/articles",
    response_model=ArticleListOut,
    summary="마스터 DB 조 목록 (간략)",
    dependencies=[Depends(require_api_key)],
)
async def get_articles() -> ArticleListOut:
    db = get_master_db()
    # 슬롯 카탈로그에서 조별 슬롯 개수
    from cgr.web.admin.store import slot_writer

    parsed = slot_writer.load_raw()
    slot_counts: dict[int, int] = {}
    for s in parsed.get("slots") or []:
        a = s.get("article")
        if isinstance(a, int):
            slot_counts[a] = slot_counts.get(a, 0) + 1

    out_rows = []
    for n in db.all_articles():
        art = db.article(n) or {}
        out_rows.append(
            {
                "no": n,
                "title": art.get("title", ""),
                "scope": art.get("scope", ""),
                "slot_count": slot_counts.get(n, 0),
            }
        )
    return ArticleListOut(
        total=len(out_rows),
        db_path=str(_resolve_path()),
        articles=out_rows,
    )


@router.get(
    "/articles/{no}",
    response_model=ArticleOut,
    summary="마스터 DB 조 상세",
    dependencies=[Depends(require_api_key)],
)
async def get_article(no: int) -> ArticleOut:
    db = get_master_db()
    art = db.article(no)
    if not art:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"제{no}조 not found",
        )
    # 벌칙 자동 분류
    penalty_raw = art.get("penalty", "") or ""
    lines = [l.strip() for l in str(penalty_raw).splitlines() if l.strip()]
    parts = format_for_user(lines)

    return ArticleOut(
        no=no,
        title=art.get("title", ""),
        scope=art.get("scope", "") or "",
        body=art.get("body", "") or "",
        guide=art.get("guide", "") or "",
        note=art.get("note", "") or "",
        law=art.get("law", "") or "",
        topic=art.get("topic", "") or "",
        penalty=penalty_raw,
        penalty_omission=parts["omission"],
        penalty_violation=parts["violation"],
        amend_new=art.get("amend_new", "") or "",
        amend_old=art.get("amend_old", "") or "",
        freq_issue=art.get("freq_issue", "") or "",
    )
