"""임금명세서 슬롯 카탈로그 로더.

EC 와 달리 **마스터 DB (SQLite) 만** 사용 — Phase 5 부터는 fallback 없음.

DB 가 비어있으면 `RuntimeError` — seed 가 안 된 상태이므로 즉시 가시화.
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field


class WsApplicability(BaseModel):
    """슬롯 적용 조건."""

    business_size: Literal["any", "5+", "5-"] = "any"
    worker_types: list[str] | Literal["any"] = "any"


class WsSlot(BaseModel):
    """임금명세서 슬롯 — 필수 기재 항목 1건."""

    slot_id: str
    doc: Literal["wage_statement"]
    applicability: WsApplicability
    field: str
    required_content: str = ""
    purpose: str = ""
    topic_meta: list[str] = Field(default_factory=list)
    laws: list[str] = Field(default_factory=list)

    comparator: Literal["presence"] = "presence"
    missing_severity: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"] = "MEDIUM"
    violation_severity: Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"] = "MEDIUM"
    fix_example: str = ""

    def applies_to(
        self, business_size: str | None, worker_types: list[str]
    ) -> bool:
        bs = self.applicability.business_size
        if bs != "any":
            if bs == "5+" and business_size == "5-":
                return False
            if bs == "5-" and business_size == "5+":
                return False
        wt = self.applicability.worker_types
        if wt != "any":
            user_types = set(worker_types or ["정규직"])
            slot_types = set(wt)
            if not (user_types & slot_types):
                return False
        return True


class WsCatalog(BaseModel):
    version: str
    doc: str
    description: str = ""
    slots: list[WsSlot]


@lru_cache(maxsize=2)
def load_ws_catalog() -> WsCatalog:
    """마스터 DB → WsCatalog. seed 안 됐으면 RuntimeError."""
    from cgr import db as _db

    slots: list[WsSlot] = []
    with _db.connect() as conn:
        cur = conn.execute(
            """
            SELECT
              ci.id, ci.code, ci.name, ci.required_content, ci.purpose,
              ci.comparator, ci.display_order,
              cia.business_size, cia.worker_types,
              cir.missing_severity, cir.violation_severity, cir.fix_example
            FROM check_item ci
            JOIN document_type dt ON dt.id = ci.document_type_id
            LEFT JOIN check_item_applicability cia
              ON cia.check_item_id = ci.id
            LEFT JOIN check_item_risk cir
              ON cir.check_item_id = ci.id
            WHERE dt.code = 'wage_statement'
            ORDER BY ci.display_order, ci.id
            """
        )
        rows = cur.fetchall()
        if not rows:
            raise RuntimeError(
                "wage_statement 슬롯이 master.db 에 없습니다. "
                "`python mvp/scripts/seed_master_db.py --drop-first` 실행."
            )

        for r in rows:
            # worker_types JSON → list 또는 "any"
            wt_raw = r["worker_types"]
            wt_parsed: list[str] | Literal["any"]
            if wt_raw:
                try:
                    parsed = json.loads(wt_raw)
                except Exception:
                    parsed = ["any"]
                if (
                    isinstance(parsed, list)
                    and (not parsed or parsed == ["any"])
                ):
                    wt_parsed = "any"
                else:
                    wt_parsed = parsed if isinstance(parsed, list) else "any"
            else:
                wt_parsed = "any"

            bs = r["business_size"] or "any"
            if bs not in ("any", "5+", "5-"):
                bs = "any"

            topic_meta = _fetch_topic_meta(conn, r["id"])
            laws = _fetch_laws(conn, r["id"])

            missing_sev = r["missing_severity"] or "MEDIUM"
            violation_sev = r["violation_severity"] or "MEDIUM"
            if missing_sev not in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
                missing_sev = "MEDIUM"
            if violation_sev not in ("CRITICAL", "HIGH", "MEDIUM", "LOW"):
                violation_sev = "MEDIUM"

            slots.append(
                WsSlot(
                    slot_id=r["code"],
                    doc="wage_statement",
                    applicability=WsApplicability(
                        business_size=bs,  # type: ignore[arg-type]
                        worker_types=wt_parsed,
                    ),
                    field=r["name"],
                    required_content=r["required_content"] or "",
                    purpose=r["purpose"] or "",
                    topic_meta=topic_meta,
                    laws=laws,
                    comparator="presence",
                    missing_severity=missing_sev,  # type: ignore[arg-type]
                    violation_severity=violation_sev,  # type: ignore[arg-type]
                    fix_example=r["fix_example"] or "",
                )
            )
    return WsCatalog(
        version="sql-v1",
        doc="wage_statement",
        description=f"loaded from master.db (SQLite) · {len(slots)} slots",
        slots=slots,
    )


def _fetch_topic_meta(conn, check_item_id: int) -> list[str]:
    cur = conn.execute(
        """
        SELECT t.name AS topic, ts.section_no AS sec
        FROM check_item_topic cit
        JOIN topic_section ts ON ts.id = cit.topic_section_id
        JOIN topic t          ON t.id = ts.topic_id
        WHERE cit.check_item_id = ?
        ORDER BY t.name, ts.section_no
        """,
        (check_item_id,),
    )
    return [f"{r['topic']} {r['sec']}" for r in cur.fetchall()]


def _fetch_laws(conn, check_item_id: int) -> list[str]:
    cur = conn.execute(
        """
        SELECT l.code AS law, la.article_no AS art,
               la.paragraph_no AS para, la.item_no AS item
        FROM check_item_law cil
        JOIN law_article la ON la.id = cil.law_article_id
        JOIN law l          ON l.id = la.law_id
        WHERE cil.check_item_id = ?
        ORDER BY l.code, la.article_no
        """,
        (check_item_id,),
    )
    out: list[str] = []
    for r in cur.fetchall():
        parts = [r["law"]]
        if r["art"]:
            parts.append(r["art"])
        if r["para"]:
            parts.append(r["para"])
        if r["item"]:
            parts.append(r["item"])
        out.append(" ".join(parts))
    return out
