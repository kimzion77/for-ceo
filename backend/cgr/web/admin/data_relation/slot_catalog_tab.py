"""📋 슬롯 카탈로그 요약 탭 — 조별 슬롯 개수·comparator·severity 분포.

이전: `06_🗂_데이터관계.py` 의 `tab_slot` 블록 (라인 823~889).
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
    "(미지정)": "#e5e7eb",
}


def render(slots, db, hist_rows) -> None:
    """슬롯 카탈로그 요약 탭 렌더."""
    _ = hist_rows  # 미사용

    st.markdown("### 📋 슬롯 카탈로그 요약")

    # 조별 슬롯 개수 (Top 15)
    slots_per_art: Counter = Counter()
    for s in slots:
        slots_per_art[s.article] += 1
    top_arts = slots_per_art.most_common(15)
    df_arts = pd.DataFrame(
        [
            {"조": f"제{n}조 {(db.title(n) or '')[:14]}", "슬롯 수": cnt}
            for n, cnt in top_arts
        ]
    )
    fig_arts = px.bar(
        df_arts,
        x="슬롯 수",
        y="조",
        orientation="h",
        title="조항별 슬롯 개수 Top 15",
    )
    fig_arts.update_layout(yaxis={"categoryorder": "total ascending"}, height=450)
    st.plotly_chart(fig_arts, use_container_width=True)

    # comparator·severity 분포
    cc1, cc2 = st.columns(2)
    with cc1:
        comp_all = Counter(s.comparator for s in slots)
        df_comp = pd.DataFrame(list(comp_all.items()), columns=["comparator", "수"])
        fig_co = px.pie(
            df_comp, names="comparator", values="수",
            title="comparator 분포 (전체)", hole=0.4,
        )
        st.plotly_chart(fig_co, use_container_width=True)

    with cc2:
        sev_all = Counter(s.violation_severity or "(미지정)" for s in slots)
        df_sev = pd.DataFrame(list(sev_all.items()), columns=["severity", "수"])
        fig_so = px.pie(
            df_sev,
            names="severity",
            values="수",
            title="severity 분포 (전체)",
            hole=0.4,
            color="severity",
            color_discrete_map=_SEV_COLORS,
        )
        st.plotly_chart(fig_so, use_container_width=True)

    # 슬롯 전체 표
    st.markdown("#### 📜 전체 슬롯 목록")
    df_slots = pd.DataFrame(
        [
            {
                "slot_id": s.slot_id,
                "조": s.article,
                "comparator": s.comparator,
                "severity": s.violation_severity or "",
                "required": s.required,
                "topic_meta": " · ".join(s.topic_meta) if s.topic_meta else "",
            }
            for s in slots
        ]
    )
    st.dataframe(df_slots, use_container_width=True, hide_index=True, height=500)
