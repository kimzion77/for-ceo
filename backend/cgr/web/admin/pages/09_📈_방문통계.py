"""방문·서비스 통계 페이지.

수집 대상:
  - 취업규칙 검토 앱(8501) 방문·검토 이벤트
  - 관리자 앱(8502) 방문 이벤트
  - 향후: 근로계약서·임금명세서 프로젝트 (같은 access_log 공유)

표시:
  - KPI: 총 방문·7일·30일·고유 세션
  - 일자별 시계열 (서비스별 stack)
  - 서비스별 도넛
  - 액션별 막대 (visit/review/edit/...)
  - 시간대별 분포 (heatmap: 요일 × 시각)
"""
from __future__ import annotations

import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[4]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import pandas as pd
import plotly.express as px
import streamlit as st

from cgr.web.admin.auth import require_login
from cgr.web.admin.theme import inject_civic_theme
from cgr.store import access_log
from cgr.web.admin.ui_common import page_header


st.set_page_config(page_title="방문 통계", page_icon="📈", layout="wide")
inject_civic_theme()
require_login()
page_header(
    "방문·서비스 사용 통계",
    icon="📈",
    description="취업규칙 / 근로계약서 / 임금명세서 / 관리자 앱의 방문·이벤트 누적 통계.",
)


events = access_log.read_events()
if not events:
    st.info(
        "📂 아직 누적된 방문 이벤트가 없습니다.\n\n"
        "검토 앱(8501) 또는 관리자 앱(8502) 페이지를 새로고침하면 자동으로 수집됩니다.\n\n"
        f"수집 위치: `{access_log.log_path()}`"
    )
    st.stop()


s = access_log.stats(events)

# ─── KPI ────────────────────────────
cols = st.columns(4)
cols[0].metric("총 이벤트", f"{s['n_total']:,}")
cols[1].metric("최근 7일", f"{s['n_7d']:,}")
cols[2].metric("최근 30일", f"{s['n_30d']:,}")

# review = 검토 완료 카운트
n_review = s["by_action"].get("review", 0)
cols[3].metric("검토 완료", f"{n_review:,}")

st.divider()


# ─── 필터 ────────────────────────────
fc1, fc2 = st.columns([2, 2])
all_services = sorted({e.get("service", "") for e in events if e.get("service")})
f_service = fc1.multiselect("서비스 필터", all_services, default=[])

all_actions = sorted({e.get("action", "") for e in events if e.get("action")})
f_action = fc2.multiselect("액션 필터", all_actions, default=[])


def _keep(e):
    if f_service and e.get("service") not in f_service:
        return False
    if f_action and e.get("action") not in f_action:
        return False
    return True


filtered = [e for e in events if _keep(e)]
st.caption(f"필터 결과: **{len(filtered):,}**건 / 전체 {len(events):,}건")

st.divider()


# ─── 일자별 시계열 (서비스 stack) ──
df = pd.DataFrame(filtered)
df["date"] = df["ts"].str[:10]
df["hour"] = df["ts"].str[11:13].astype(int, errors="ignore")

# 일자별 카운트
daily = df.groupby(["date", "service"]).size().reset_index(name="이벤트")
fig_daily = px.bar(
    daily,
    x="date",
    y="이벤트",
    color="service",
    title="📅 일자별 이벤트 (서비스 stack)",
    color_discrete_map={
        "취업규칙": "#3b82f6",
        "근로계약서": "#10b981",
        "임금명세서": "#f59e0b",
        "관리자": "#a855f7",
    },
)
st.plotly_chart(fig_daily, use_container_width=True)


# ─── 서비스 도넛 + 액션 막대 ──
sc1, sc2 = st.columns(2)
with sc1:
    df_svc = pd.DataFrame(
        [{"service": k, "이벤트 수": v} for k, v in s["by_service"].items()]
    )
    if not df_svc.empty:
        fig_svc = px.pie(
            df_svc,
            names="service",
            values="이벤트 수",
            title="🎯 서비스별 이벤트 비율",
            hole=0.4,
            color="service",
            color_discrete_map={
                "취업규칙": "#3b82f6",
                "근로계약서": "#10b981",
                "임금명세서": "#f59e0b",
                "관리자": "#a855f7",
            },
        )
        st.plotly_chart(fig_svc, use_container_width=True)

with sc2:
    df_act = pd.DataFrame(
        [{"action": k, "수": v} for k, v in s["by_action"].items()]
    )
    if not df_act.empty:
        fig_act = px.bar(
            df_act.sort_values("수", ascending=True),
            x="수",
            y="action",
            orientation="h",
            title="🔧 액션별 빈도",
        )
        st.plotly_chart(fig_act, use_container_width=True)


# ─── 시간대 분포 (요일 × 시각 heatmap) ──
st.markdown("### ⏰ 사용 시간대 분포")
df["weekday"] = pd.to_datetime(df["date"]).dt.day_name()
WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
WEEKDAY_KR = {
    "Monday": "월", "Tuesday": "화", "Wednesday": "수", "Thursday": "목",
    "Friday": "금", "Saturday": "토", "Sunday": "일",
}
df["요일"] = df["weekday"].map(WEEKDAY_KR)

heat = (
    df.groupby(["요일", "hour"]).size().reset_index(name="건수")
)
if not heat.empty:
    pivot = heat.pivot(index="요일", columns="hour", values="건수").fillna(0)
    ordered = [WEEKDAY_KR[w] for w in WEEKDAY_ORDER if WEEKDAY_KR[w] in pivot.index]
    pivot = pivot.reindex(ordered)
    fig_heat = px.imshow(
        pivot,
        aspect="auto",
        labels=dict(x="시각", y="요일", color="건수"),
        title="요일 × 시각 사용 분포",
        color_continuous_scale="Blues",
    )
    st.plotly_chart(fig_heat, use_container_width=True)


# ─── 최근 이벤트 테이블 ──
st.divider()
st.markdown(f"### 📜 최근 이벤트 ({min(200, len(filtered))}건)")

recent = filtered[-200:][::-1]
table_rows = []
for e in recent:
    table_rows.append(
        {
            "시각": e.get("ts", "")[:19].replace("T", " "),
            "서비스": e.get("service", ""),
            "액션": e.get("action", ""),
            "메타": str(e.get("meta", ""))[:80],
        }
    )
st.dataframe(pd.DataFrame(table_rows), use_container_width=True, hide_index=True, height=400)


# ─── 정리 도구 ──
st.divider()
with st.expander("🧹 로그 정리"):
    st.caption(f"📂 `{access_log.log_path()}` · 총 {len(events):,}건")
    keep_n = st.number_input("유지할 최근 이벤트 수", min_value=100, max_value=100000, value=10000, step=100)
    if st.button("✂️ 오래된 로그 정리"):
        try:
            removed = access_log.truncate(keep_last=keep_n)
            st.success(f"✅ {removed:,}건 제거. 최근 {keep_n:,}건 유지.")
            st.rerun()
        except Exception as e:
            st.error(f"❌ 실패: {e}")
