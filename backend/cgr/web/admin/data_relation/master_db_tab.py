"""📚 마스터 DB 조회 탭 — 표준취업규칙 본문·법령·벌칙 read-only 조회.

이전: `06_🗂_데이터관계.py` 의 `tab_db` 블록 (라인 690~817).
"""
from __future__ import annotations

import pandas as pd
import streamlit as st

from cgr.penalty_parser import format_for_user


def render(slots, db, hist_rows) -> None:
    """마스터 DB 조회 탭 렌더."""
    _ = hist_rows  # 미사용

    articles = db.all_articles()

    st.markdown(f"### 📚 표준취업규칙 마스터 DB ({len(articles)}개 조)")
    st.caption(f"📂 `{db.path.name}` · read-only")

    sc1, sc2 = st.columns([2, 1])
    art_search = sc1.text_input("🔍 조 제목·본문·법령·키워드 검색")
    only_required = sc2.selectbox("필수/선택", ["전체", "필수", "선택"])

    rows_db = _build_rows(articles, db, slots, art_search, only_required)

    st.dataframe(
        pd.DataFrame(rows_db),
        use_container_width=True,
        hide_index=True,
        height=320,
    )

    st.markdown("---")

    valid_arts = [r["조"] for r in rows_db]
    if not valid_arts:
        return

    target_art = st.selectbox(
        "📖 상세 보기 — 조 선택",
        valid_arts,
        format_func=lambda n: f"제{n}조 {db.title(n) or ''}",
    )

    art = db.article(target_art)
    if not art:
        return

    _render_article_detail(target_art, art, slots)


def _matches(art_no: int, art: dict, kw: str, only_required: str) -> bool:
    if only_required != "전체":
        scope = (art.get("scope") or "").strip()
        if only_required == "필수" and "필수" not in scope:
            return False
        if only_required == "선택" and "선택" not in scope:
            return False
    if kw:
        hay = " ".join(
            [
                str(art_no),
                str(art.get("title", "")),
                str(art.get("body", "")),
                str(art.get("law", "")),
                str(art.get("topic", "")),
            ]
        ).lower()
        if kw not in hay:
            return False
    return True


def _build_rows(articles, db, slots, art_search: str, only_required: str) -> list[dict]:
    kw = art_search.lower() if art_search else ""
    rows = []
    art_dict = {n: db.article(n) for n in articles if db.article(n) is not None}

    for n in articles:
        art = art_dict.get(n)
        if not art or not _matches(n, art, kw, only_required):
            continue
        slot_n = sum(1 for s in slots if s.article == n)
        rows.append(
            {
                "조": n,
                "제목": art.get("title", ""),
                "필수/선택": art.get("scope", ""),
                "슬롯 수": slot_n,
                "벌칙": (art.get("penalty") or "")[:60],
            }
        )
    return rows


def _render_article_detail(target_art: int, art: dict, slots) -> None:
    d1, d2 = st.columns(2)
    with d1:
        st.markdown(f"#### 📜 제{target_art}조 — {art.get('title', '')}")
        st.caption(f"필수/선택: **{art.get('scope', '?')}**")
        st.markdown("**📄 표준 본문 (D)**")
        st.code(art.get("body", "") or "(없음)", language="text")
        st.markdown("**📝 작성시 착안사항 (E)**")
        st.markdown(art.get("guide", "") or "_(없음)_")
        st.markdown("**📌 참고 (F)**")
        st.markdown(art.get("note", "") or "_(없음)_")

    with d2:
        st.markdown("**⚖️ 관련 법령 (G)**")
        st.markdown(art.get("law", "") or "_(없음)_")

        # 벌칙 — 미기재 / 법령 위반 분리
        penalty_raw = art.get("penalty", "") or ""
        st.markdown("**🚫 벌칙 (I)**")
        if penalty_raw.strip():
            lines = [l.strip() for l in penalty_raw.splitlines() if l.strip()]
            parts = format_for_user(lines)
            if parts["omission"]:
                st.markdown("📋 *취업규칙 미기재 시*")
                for p in parts["omission"]:
                    st.markdown(f"- {p}")
            if parts["violation"]:
                st.markdown("⚖️ *법령 위반 시*")
                for p in parts["violation"]:
                    st.markdown(f"- {p}")
            if not parts["omission"] and not parts["violation"]:
                st.markdown(penalty_raw)
        else:
            st.markdown("_(없음)_")

        st.markdown("**🏷 연관 주제 (H)**")
        st.markdown(art.get("topic", "") or "_(없음)_")
        st.markdown("**📌 빈출 지적 (N)**")
        st.markdown(art.get("freq_issue", "") or "_(없음)_")

    # 매핑된 슬롯들
    mapped_slots = [s for s in slots if s.article == target_art]
    if mapped_slots:
        st.markdown(f"#### 🔗 매핑된 슬롯 ({len(mapped_slots)}개)")
        msr = [
            {
                "slot_id": s.slot_id,
                "comparator": s.comparator,
                "severity": s.violation_severity or "",
                "required": s.required,
            }
            for s in mapped_slots
        ]
        st.dataframe(pd.DataFrame(msr), use_container_width=True, hide_index=True)
