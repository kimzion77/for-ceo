"""검토 이력 조회·통계 페이지.

기능:
  - 상단 KPI: 총 검토 수 · 최근 30일 · 평균 위반·누락 수
  - 일자별 stacked bar (버킷별)
  - severity 도넛
  - 빈출 위반 슬롯 Top 10
  - 사업장 테이블 + 멀티선택 → 비교 heatmap
  - 필터: 기간 · 슬롯 ID 검색

데이터 출처: data/review_history.jsonl (검토 시 자동 누적)
"""
from __future__ import annotations

import sys
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[4]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import pandas as pd
import plotly.express as px
import streamlit as st

from cgr.web.admin.auth import require_login
from cgr.web.admin.theme import inject_civic_theme
from cgr.store import history
from cgr.web.admin.ui_common import page_header

st.set_page_config(page_title="검토 이력", page_icon="📊", layout="wide")
inject_civic_theme()
require_login()
page_header(
    "검토 이력",
    icon="📊",
    description="사업장별 검토 결과 누적·통계 차트·빈출 위반 슬롯 Top 10. 자동 저장된 이력 기반.",
)


# ─── 데이터 로드 ──────────────────────────
rows = history.read_history()
if not rows:
    st.info(
        "📂 아직 누적된 검토 이력이 없습니다.\n\n"
        "검토 앱(port 8501)에서 사업장 파일을 검토하면 자동으로 "
        "`data/review_history.jsonl` 에 누적됩니다."
    )
    st.stop()


# ─── KPI ──────────────────────────────────
s = history.stats(rows)
cols = st.columns(4)
cols[0].metric("총 검토 건수", s.get("n_total", 0))
cols[1].metric("최근 30일", s.get("n_recent_30d", 0))
cols[2].metric("평균 위반 (건/사업장)", s.get("avg_violation", 0))
cols[3].metric("평균 누락 (건/사업장)", s.get("avg_missing", 0))

st.divider()


# ─── 필터 ─────────────────────────────────
fc1, fc2 = st.columns([2, 1])

# 기간 필터
ts_list = [r.get("ts", "") for r in rows if r.get("ts")]
if ts_list:
    min_dt = min(ts_list)[:10]
    max_dt = max(ts_list)[:10]
    date_range = fc1.date_input(
        "기간",
        value=(datetime.fromisoformat(min_dt).date(), datetime.fromisoformat(max_dt).date()),
        min_value=datetime.fromisoformat(min_dt).date(),
        max_value=datetime.fromisoformat(max_dt).date(),
    )
else:
    date_range = None

slot_filter = fc2.text_input("슬롯 ID 검색 (위반·누락 항목)")

# 서비스 필터 (취업규칙·근로계약서·임금명세서)
all_services = sorted({r.get("service", "취업규칙") for r in rows})
if len(all_services) > 1:
    f_service = st.multiselect("서비스", all_services, default=all_services)
else:
    f_service = all_services


def _in_range(r: dict) -> bool:
    if not date_range or not isinstance(date_range, tuple) or len(date_range) != 2:
        return True
    ts = r.get("ts", "")[:10]
    if not ts:
        return True
    try:
        d = datetime.fromisoformat(ts).date()
        return date_range[0] <= d <= date_range[1]
    except Exception:
        return True


def _has_slot(r: dict) -> bool:
    if not slot_filter:
        return True
    return any(slot_filter in sid for sid in r.get("top_violations", []) or [])


def _service_ok(r: dict) -> bool:
    if not f_service:
        return True
    return r.get("service", "취업규칙") in f_service


filtered = [r for r in rows if _in_range(r) and _has_slot(r) and _service_ok(r)]
st.caption(f"필터 결과: **{len(filtered)}**건 / 전체 {len(rows)}건")


# ─── 일자별 분포 ──────────────────────────
def _daily_counts(history_rows):
    daily: dict[str, Counter] = {}
    for r in history_rows:
        d = r.get("ts", "")[:10]
        if not d:
            continue
        if d not in daily:
            daily[d] = Counter()
        for k, v in (r.get("by_bucket") or {}).items():
            daily[d][k] += v
    rows_out = []
    for d, c in sorted(daily.items()):
        for k, v in c.items():
            rows_out.append({"date": d, "버킷": k, "건수": v})
    return rows_out


daily_rows = _daily_counts(filtered)
if daily_rows:
    df_daily = pd.DataFrame(daily_rows)
    color_map = {
        "누락": "#dc2626",
        "위반": "#ea580c",
        "주의": "#facc15",
        "검토필요": "#a855f7",
        "적정": "#22c55e",
    }
    fig = px.bar(
        df_daily,
        x="date",
        y="건수",
        color="버킷",
        title="일자별 분포 (스택)",
        color_discrete_map=color_map,
    )
    st.plotly_chart(fig, use_container_width=True)


# ─── severity 도넛 + 빈출 슬롯 ──────────────
sc1, sc2 = st.columns(2)

with sc1:
    sev_total: Counter = Counter()
    for r in filtered:
        for k, v in (r.get("by_severity") or {}).items():
            sev_total[k] += v
    if sev_total:
        df_sev = pd.DataFrame(
            {"severity": list(sev_total.keys()), "건수": list(sev_total.values())}
        )
        fig2 = px.pie(
            df_sev, names="severity", values="건수", title="severity 분포 (전체)", hole=0.4
        )
        st.plotly_chart(fig2, use_container_width=True)

with sc2:
    slot_counter: Counter = Counter()
    for r in filtered:
        for sid in r.get("top_violations", []) or []:
            slot_counter[sid] += 1
    top10 = slot_counter.most_common(10)
    if top10:
        df_top = pd.DataFrame(top10, columns=["슬롯", "잡힌 횟수"])
        fig3 = px.bar(
            df_top, x="잡힌 횟수", y="슬롯", orientation="h", title="빈출 위반·누락 슬롯 Top 10"
        )
        fig3.update_layout(yaxis={"categoryorder": "total ascending"})
        st.plotly_chart(fig3, use_container_width=True)

st.divider()


# ─── 사업장 테이블 + 비교 ───────────────────
st.markdown("### 사업장 검토 결과")

table_rows = []
for r in filtered:
    bb = r.get("by_bucket") or {}
    table_rows.append(
        {
            "검토 시각": r.get("ts", "")[:19].replace("T", " "),
            "case_id": r.get("case_id", ""),
            "파일명": r.get("filename", ""),
            "종합": r.get("overall_label", ""),
            "🔴 누락": bb.get("누락", 0),
            "🟠 위반": bb.get("위반", 0),
            "🟡 주의": bb.get("주의", 0),
            "🟣 검토필요": bb.get("검토필요", 0),
            "✅ 적정": bb.get("적정", 0),
        }
    )

df_table = pd.DataFrame(table_rows)
selection = st.dataframe(
    df_table,
    use_container_width=True,
    height=380,
    hide_index=True,
    selection_mode="multi-row",
    on_select="rerun",
)

selected_idx = selection.selection.rows if hasattr(selection, "selection") else []

if selected_idx and len(selected_idx) >= 2:
    st.markdown("#### 📊 선택 사업장 비교")
    selected_rows = [filtered[i] for i in selected_idx]

    # slot_id × 사업장 heatmap
    all_slots: set[str] = set()
    for r in selected_rows:
        for sid in r.get("top_violations", []) or []:
            all_slots.add(sid)

    if all_slots:
        slot_list = sorted(all_slots)
        files = [r.get("filename", r.get("case_id", "?")) for r in selected_rows]
        matrix = []
        for sid in slot_list:
            row = []
            for r in selected_rows:
                row.append(1 if sid in (r.get("top_violations") or []) else 0)
            matrix.append(row)

        df_heat = pd.DataFrame(matrix, index=slot_list, columns=files)
        fig_heat = px.imshow(
            df_heat,
            labels=dict(x="사업장", y="슬롯", color="잡힘 여부"),
            aspect="auto",
            title=f"슬롯 × 사업장 매트릭스 ({len(selected_rows)}개 비교)",
            color_continuous_scale=["#f3f4f6", "#dc2626"],
        )
        fig_heat.update_layout(height=max(400, 20 * len(slot_list)))
        st.plotly_chart(fig_heat, use_container_width=True)
elif selected_idx and len(selected_idx) == 1:
    r = filtered[selected_idx[0]]
    with st.expander(f"📄 상세: {r.get('filename', r.get('case_id', ''))}", expanded=True):
        st.json(r, expanded=False)
        rp = r.get("report_path")
        if rp and Path(rp).exists():
            st.caption(f"📂 리포트 파일: `{rp}`")


# ─── 다운로드 ────────────────────────────
st.divider()
with st.expander("⬇️ 이력 내보내기"):
    csv = pd.DataFrame(table_rows).to_csv(index=False).encode("utf-8-sig")
    st.download_button(
        "📊 CSV 다운로드 (현재 필터)", data=csv, file_name="review_history.csv", mime="text/csv"
    )
    import json as _json

    jsonl = "\n".join(_json.dumps(r, ensure_ascii=False) for r in filtered)
    st.download_button(
        "📝 JSONL 다운로드 (원본)",
        data=jsonl.encode("utf-8"),
        file_name="review_history.jsonl",
        mime="application/jsonl",
    )
