"""데이터 관계도 페이지 (관리자).

마스터 DB ↔ 슬롯 카탈로그 ↔ 검토 결과의 관계 + 위반 통계 + 마스터 DB 조회.

각 탭의 본문은 `cgr/web/admin/data_relation/` 패키지로 분리:
  - graph_tab          : 🕸 관계 그래프 (노드·엣지 시각화)
  - distribution_tab   : 🗺 전체 분포 (sunburst + heatmap)
  - frequency_tab      : 🚨 위반 빈도 통계 (조항·주제·severity·comparator)
  - master_db_tab      : 📚 마스터 DB 조회 (98조 read-only)
  - slot_catalog_tab   : 📋 슬롯 카탈로그 요약
"""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[4]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import streamlit as st

from cgr.catalog import load_catalog_with_master_db
from cgr.master_db import get_master_db
from cgr.web.admin.auth import require_login
from cgr.web.admin.theme import inject_civic_theme
from cgr.web.admin.data_relation import (
    distribution_tab,
    frequency_tab,
    graph_tab,
    master_db_tab,
    slot_catalog_tab,
)
from cgr.store import history
from cgr.web.admin.ui_common import page_header


st.set_page_config(page_title="데이터 관계", page_icon="🗂", layout="wide")
inject_civic_theme()
require_login()
page_header(
    "데이터 관계도 · 위반 통계 · 마스터 DB",
    icon="🗂",
    description=(
        "마스터 DB ↔ 슬롯 ↔ 검토 결과의 관계 + "
        "조항/주제별 위반 빈도 통계 + 마스터 DB 조회."
    ),
)


# ─── 데이터 로드 ──────────────────────
@st.cache_data(ttl=30)
def _load_all():
    yaml_path = _ROOT / "data" / "slots" / "atomic_slots_v0.yaml"
    catalog = load_catalog_with_master_db(yaml_path)
    db = get_master_db()
    hist_rows = history.read_history()
    return catalog, db, hist_rows


catalog, db, hist_rows = _load_all()
slots = catalog.slots
articles = db.all_articles()


# ─── KPI ───────────────────────────────
cols = st.columns(4)
cols[0].metric("마스터 조", f"{len(articles)}")
cols[1].metric("슬롯", f"{len(slots)}")
cols[2].metric("검토 누적", f"{len(hist_rows)}")
n_violations = sum(len(r.get("top_violations") or []) for r in hist_rows)
cols[3].metric("누적 위반·누락 카운트", f"{n_violations:,}")

st.divider()


# ─── 탭 ──────────────────────────────
tab_graph, tab_overview, tab_freq, tab_db, tab_slot = st.tabs(
    ["🕸 관계 그래프", "🗺 전체 분포", "🚨 위반 빈도 통계", "📚 마스터 DB 조회", "📋 슬롯 카탈로그"]
)

with tab_graph:
    graph_tab.render(slots, db, hist_rows)

with tab_overview:
    distribution_tab.render(slots, db, hist_rows)

with tab_freq:
    frequency_tab.render(slots, db, hist_rows)

with tab_db:
    master_db_tab.render(slots, db, hist_rows)

with tab_slot:
    slot_catalog_tab.render(slots, db, hist_rows)
