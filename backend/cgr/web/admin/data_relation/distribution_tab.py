"""🗺 전체 분포 탭 — Sunburst + severity × comparator heatmap.

이전: `06_🗂_데이터관계.py` 의 `tab_overview` 블록 (라인 499~554).
"""
from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st


_SEVERITY_COLORS = {
    "CRITICAL": "#dc2626",
    "HIGH": "#ea580c",
    "MEDIUM": "#facc15",
    "LOW": "#22c55e",
    "INFO": "#94a3b8",
    "(미지정)": "#e5e7eb",
}
_SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "(미지정)"]


def render(slots, db, hist_rows) -> None:
    """전체 분포 탭 렌더."""
    _ = hist_rows  # 미사용

    st.markdown("### 🌞 조 → 슬롯 → severity 계층 (Sunburst)")
    st.caption("바깥 → 안: severity → comparator → 조 → 슬롯. 클릭하면 드릴다운.")

    df_burst = _build_burst_df(slots, db)

    fig_sun = px.sunburst(
        df_burst,
        path=["severity", "comparator", "조"],
        values="count",
        title="severity × comparator × 조 계층",
        color="severity",
        color_discrete_map=_SEVERITY_COLORS,
    )
    fig_sun.update_layout(height=600)
    st.plotly_chart(fig_sun, use_container_width=True)

    st.divider()

    # severity × comparator heatmap
    st.markdown("### 🔥 severity × comparator 매트릭스")
    cross = (
        df_burst.groupby(["severity", "comparator"]).size().reset_index(name="슬롯 수")
    )
    if cross.empty:
        return

    pivot = cross.pivot(index="severity", columns="comparator", values="슬롯 수").fillna(0)
    pivot = pivot.reindex([s for s in _SEVERITY_ORDER if s in pivot.index])
    fig_hm = px.imshow(
        pivot,
        text_auto=True,
        aspect="auto",
        color_continuous_scale="Oranges",
        title="slot 수 (severity × comparator)",
    )
    st.plotly_chart(fig_hm, use_container_width=True)


def _build_burst_df(slots, db) -> pd.DataFrame:
    rows = []
    for s in slots:
        art = s.article
        art_title = db.title(art) or f"제{art}조"
        rows.append(
            {
                "severity": s.violation_severity or "(미지정)",
                "comparator": s.comparator,
                "조": f"제{art}조 {art_title[:14]}",
                "slot_id": s.slot_id,
                "count": 1,
            }
        )
    return pd.DataFrame(rows)
