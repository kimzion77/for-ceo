"""🚨 위반 빈도 통계 탭 — 조항·주제·severity·comparator 별 누적 빈도.

이전: `06_🗂_데이터관계.py` 의 `tab_freq` 블록 (라인 560~684).
"""
from __future__ import annotations

from collections import Counter

import pandas as pd
import plotly.express as px
import streamlit as st


_SEV_COLORS = {
    "CRITICAL": "#dc2626",
    "HIGH": "#ea580c",
    "MEDIUM": "#facc15",
    "LOW": "#22c55e",
}


def render(slots, db, hist_rows) -> None:
    """위반 빈도 통계 탭 렌더."""
    st.markdown("### 🚨 위반·누락이 자주 잡히는 조항 / 주제")

    if not hist_rows:
        st.info(
            "📂 아직 검토 이력이 없습니다.\n\n"
            "검토 앱(8501)에서 사업장 파일을 검토하면 자동으로 누적되어 통계가 표시됩니다."
        )
        return

    # 위반·누락 슬롯 카운터
    slot_counter: Counter = Counter()
    for r in hist_rows:
        for sid in r.get("top_violations", []) or []:
            slot_counter[sid] += 1

    slot_by_id = {s.slot_id: s for s in slots}

    _render_article_chart(slot_counter, slot_by_id, db)
    _render_topic_chart(slot_counter, slot_by_id)
    _render_severity_comparator(slot_counter, slot_by_id)
    _render_top_slots_table(slot_counter, slot_by_id, db, len(hist_rows))


def _render_article_chart(slot_counter, slot_by_id, db) -> None:
    article_counter: Counter = Counter()
    for sid, n in slot_counter.items():
        s = slot_by_id.get(sid)
        if s:
            title = db.title(s.article) or ""
            key = f"제{s.article}조 {title[:18]}"
            article_counter[key] += n

    if not article_counter:
        return

    top_articles = article_counter.most_common(15)
    df_a = pd.DataFrame(top_articles, columns=["조", "위반·누락 빈도"])
    fig_a = px.bar(
        df_a,
        x="위반·누락 빈도",
        y="조",
        orientation="h",
        title="🏆 조항별 위반·누락 빈도 Top 15",
    )
    fig_a.update_layout(yaxis={"categoryorder": "total ascending"}, height=500)
    st.plotly_chart(fig_a, use_container_width=True)


def _render_topic_chart(slot_counter, slot_by_id) -> None:
    topic_counter: Counter = Counter()
    for sid, n in slot_counter.items():
        s = slot_by_id.get(sid)
        if s and s.topic_meta:
            for t in s.topic_meta:
                topic_counter[t] += n

    if not topic_counter:
        return

    top_topics = topic_counter.most_common(15)
    df_t = pd.DataFrame(top_topics, columns=["주제(topic_meta)", "위반·누락 빈도"])
    fig_t = px.bar(
        df_t,
        x="위반·누락 빈도",
        y="주제(topic_meta)",
        orientation="h",
        title="🎯 주제별 위반·누락 빈도 Top 15",
        color_discrete_sequence=["#ea580c"],
    )
    fig_t.update_layout(yaxis={"categoryorder": "total ascending"}, height=500)
    st.plotly_chart(fig_t, use_container_width=True)


def _render_severity_comparator(slot_counter, slot_by_id) -> None:
    c1, c2 = st.columns(2)
    with c1:
        sev_counter: Counter = Counter()
        for sid, n in slot_counter.items():
            s = slot_by_id.get(sid)
            if s and s.violation_severity:
                sev_counter[s.violation_severity] += n
        if sev_counter:
            df_s = pd.DataFrame(list(sev_counter.items()), columns=["severity", "빈도"])
            fig_s = px.pie(
                df_s,
                names="severity",
                values="빈도",
                title="severity 분포 (위반·누락 한정)",
                hole=0.4,
                color="severity",
                color_discrete_map=_SEV_COLORS,
            )
            st.plotly_chart(fig_s, use_container_width=True)

    with c2:
        comp_counter: Counter = Counter()
        for sid, n in slot_counter.items():
            s = slot_by_id.get(sid)
            if s:
                comp_counter[s.comparator] += n
        if comp_counter:
            df_c = pd.DataFrame(list(comp_counter.items()), columns=["comparator", "빈도"])
            fig_c = px.pie(
                df_c,
                names="comparator",
                values="빈도",
                title="comparator 분포 (위반·누락)",
                hole=0.4,
            )
            st.plotly_chart(fig_c, use_container_width=True)


def _render_top_slots_table(slot_counter, slot_by_id, db, n_hist: int) -> None:
    st.markdown("#### 📜 슬롯별 위반·누락 빈도 Top 30")
    top_slots = slot_counter.most_common(30)
    slot_rows = []
    for sid, n in top_slots:
        s = slot_by_id.get(sid)
        slot_rows.append(
            {
                "slot_id": sid,
                "조": s.article if s else "?",
                "조 제목": db.title(s.article) if s else "",
                "severity": s.violation_severity if s else "",
                "comparator": s.comparator if s else "",
                "잡힌 횟수": n,
                "잡힌 비율": f"{n / n_hist * 100:.1f}%" if n_hist else "—",
            }
        )
    st.dataframe(pd.DataFrame(slot_rows), use_container_width=True, hide_index=True, height=400)
