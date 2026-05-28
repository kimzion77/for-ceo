"""꿀팁 가이드 DB 대시보드 (read-only).

Phase 16-A 에서 추가된 11 개 가이드 테이블을 관리자가 한눈에 보고 검증하는 화면.

레이아웃
  ┌────────────────────────────────────────────────────────┐
  │  Hero  (그라데이션 — "영세사업주 자율점검 가이드")        │
  ├────────────────────────────────────────────────────────┤
  │  KPI strip × 8                                          │
  │    가이드·의무·공식·용어·서식·기관·비치서류·라이프사이클│
  ├────────────────────────────────────────────────────────┤
  │  자율점검 원칙 안내 (info bar)                          │
  │    "분쟁·진정 데이터는 시드 단계에서 제외 + 방어적 필터" │
  ├────────────────────────────────────────────────────────┤
  │  Pill 탭 8개                                            │
  │   📊 개요 · 📋 의무 · 💰 공식 · 📄 서식                │
  │   📖 용어/가이드 · 🏛 기관 · 📂 비치서류 · 🎯 채용·감사 │
  └────────────────────────────────────────────────────────┘

자율점검 본질을 시각적으로 강조:
  - audience 분포 (employer / worker / both)
  - excluded_from_service 카운트 (= 0 이어야 정상)
  - wage_calc_formula.related_violation_code → V001~V010 매핑 검증
"""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[4]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import pandas as pd
import streamlit as st

from cgr import db as _db
from cgr.web.admin.auth import require_login
from cgr.web.admin.theme import (
    card_open,
    hero,
    inject_civic_theme,
    risk_chip,
    section_header,
    stat_row,
)


# ─── 페이지 설정 ────────────────────────────────────────
st.set_page_config(
    page_title="꿀팁 가이드 DB",
    page_icon="📘",
    layout="wide",
    initial_sidebar_state="expanded",
)
inject_civic_theme()
require_login()


# ─── 공통 헬퍼 ──────────────────────────────────────────
@st.cache_data(ttl=30)
def _q(sql: str, params: tuple = ()) -> pd.DataFrame:
    with _db.connect() as conn:
        cur = conn.execute(sql, params)
        cols = [d[0] for d in cur.description] if cur.description else []
        rows = [list(r) for r in cur.fetchall()]
    return pd.DataFrame(rows, columns=cols)


@st.cache_data(ttl=30)
def _counts() -> dict[str, int]:
    return _db.table_counts()


GUIDE_TABLES = [
    "guide_item",
    "obligation_timeline",
    "wage_calc_formula",
    "guide_glossary",
    "form_template",
    "gov_org",
    "audit_guide",
    "required_document",
    "recruit_compliance",
    "size_threshold_duty",
    "employment_lifecycle",
]


# ─── Hero + KPI strip ───────────────────────────────────
hero(
    title="꿀팁 가이드 DB",
    subtitle="영세사업주를 위한 노무 가이드 — Phase 16 (11 테이블 + 1 뷰)",
    icon="📘",
)

counts = _counts()
c1, c2, c3, c4, c5, c6, c7, c8 = st.columns(8)
c1.metric("가이드 항목", f"{counts.get('guide_item', 0):,}")
c2.metric("시기별 의무", f"{counts.get('obligation_timeline', 0):,}")
c3.metric("임금 공식", f"{counts.get('wage_calc_formula', 0):,}")
c4.metric("용어 사전", f"{counts.get('guide_glossary', 0):,}")
c5.metric("표준 서식", f"{counts.get('form_template', 0):,}")
c6.metric("정부 기관", f"{counts.get('gov_org', 0):,}")
c7.metric("비치 서류", f"{counts.get('required_document', 0):,}")
c8.metric("라이프사이클", f"{counts.get('employment_lifecycle', 0):,}")

st.write("")

# 자율점검 원칙 안내
st.markdown(
    '<div style="background:#FFF8E1;border:1px solid #F4C430;'
    'border-radius:12px;padding:12px 16px;margin-bottom:16px;'
    'font-size:13px;color:#0F1B2D;line-height:1.65;">'
    "<b>🛡 자율점검 원칙</b> — "
    "분쟁·진정·구제 신청 관련 데이터(서식 5건, 기관 8건)는 "
    "Excel 시드 단계에서 <b>완전 제외</b>되었고, 각 테이블의 "
    "<code>excluded_from_service</code> 컬럼으로 방어적 필터까지 이중화되어 있습니다. "
    "API 는 <code>audience IN ('employer','both')</code> 기본 필터를 적용합니다."
    "</div>",
    unsafe_allow_html=True,
)


# ─── Pill 탭 ────────────────────────────────────────────
tab_overview, tab_duty, tab_calc, tab_form, tab_glossary, tab_org, tab_docs, tab_audit = st.tabs(
    [
        "📊 개요",
        "📋 의무 (시기·규모·생애주기)",
        "💰 계산 공식",
        "📄 표준 서식",
        "📖 용어 · 가이드",
        "🏛 정부 기관",
        "📂 비치 서류",
        "🎯 채용 · 감사",
    ]
)


# ───────────────────────────────────────────────────────
# 1) 📊 개요
# ───────────────────────────────────────────────────────
with tab_overview:
    col_l, col_r = st.columns([1.1, 1])

    with col_l:
        card_open(
            "audience 분포",
            caption="employer / worker / both — 자율점검 API 는 worker 만 단독 노출 안 함",
        )
        # audience 컬럼이 있는 테이블만
        audience_tables = [
            "guide_item",
            "form_template",
            "gov_org",
        ]
        rows = []
        for t in audience_tables:
            df = _q(
                f"SELECT '{t}' AS 테이블, audience, COUNT(*) AS n "
                f"FROM {t} GROUP BY audience"
            )
            rows.append(df)
        if rows:
            df_aud = pd.concat(rows, ignore_index=True)
            piv = df_aud.pivot_table(
                index="테이블", columns="audience", values="n", fill_value=0
            ).reset_index()
            st.dataframe(piv, hide_index=True, use_container_width=True)

        st.write("")
        card_open(
            "excluded_from_service 확인",
            caption="시드 단계 제외 + 방어적 컬럼. 모두 0 이면 정상.",
        )
        excl_rows = []
        # excluded_from_service 컬럼 보유 테이블만 (실제 스키마 기준)
        excl_tables = [
            "guide_item",
            "obligation_timeline",
            "form_template",
            "gov_org",
        ]
        for t in excl_tables:
            try:
                n_total = _q(f"SELECT COUNT(*) AS n FROM {t}")["n"].iloc[0]
                n_excl = _q(
                    f"SELECT COUNT(*) AS n FROM {t} WHERE excluded_from_service = 1"
                )["n"].iloc[0]
                excl_rows.append(
                    {"테이블": t, "전체": int(n_total), "제외": int(n_excl)}
                )
            except Exception:
                pass
        df_excl = pd.DataFrame(excl_rows)
        if not df_excl.empty:
            total_excl = int(df_excl["제외"].sum())
            if total_excl == 0:
                st.success(
                    f"✅ 모든 {len(df_excl)} 테이블에서 제외 플래그 0건 — "
                    "시드 단계 사전 제외가 정상 작동했습니다."
                )
            else:
                st.warning(f"⚠️ 제외 플래그 {total_excl}건 — 검토 필요")
            st.dataframe(df_excl, hide_index=True, use_container_width=True)

    with col_r:
        card_open(
            "가이드 테이블 행 수 (11)",
            caption="Phase 16-A 시드 결과",
        )
        rows = [(t, counts.get(t, 0)) for t in GUIDE_TABLES]
        df_cnt = pd.DataFrame(rows, columns=["테이블", "행 수"])
        st.dataframe(df_cnt, hide_index=True, use_container_width=True)

        st.write("")
        card_open(
            "v_guide_for_employer 뷰",
            caption="audience IN ('employer','both') AND excluded_from_service = 0",
        )
        try:
            df_view = _q("SELECT COUNT(*) AS n FROM v_guide_for_employer")
            st.metric(
                "employer-safe 가이드 항목",
                f"{int(df_view['n'].iloc[0]):,}",
                help="이 숫자가 가이드 페이지에 노출되는 최대치",
            )
        except Exception as e:
            st.error(f"뷰 조회 실패: {e}")


# ───────────────────────────────────────────────────────
# 2) 📋 의무
# ───────────────────────────────────────────────────────
with tab_duty:
    sub_t, sub_s, sub_l = st.tabs(
        ["⏰ 시기별 (obligation_timeline)", "🏢 규모별 (size_threshold_duty)", "♻️ 생애주기 (employment_lifecycle)"]
    )

    with sub_t:
        df = _q(
            "SELECT code, stage, duty, deadline, priority, legal_basis, penalty "
            "FROM obligation_timeline "
            "WHERE excluded_from_service = 0 "
            "ORDER BY stage, code"
        )
        if df.empty:
            st.info("시드 데이터 없음.")
        else:
            # 단계별 KPI
            stages = df["stage"].value_counts().to_dict()
            cols = st.columns(min(len(stages), 5))
            for i, (stage, n) in enumerate(stages.items()):
                cols[i % len(cols)].metric(stage, int(n))
            st.write("")

            card_open(
                f"시기별 의무  ·  {len(df)}건",
                caption="사업개시 → 채용 → 근로 중 → 종료 단계 매핑",
            )
            stage_filter = st.multiselect(
                "단계 필터",
                options=sorted(df["stage"].unique().tolist()),
                default=sorted(df["stage"].unique().tolist()),
                key="g_dt_stage",
            )
            shown = df[df["stage"].isin(stage_filter)]
            st.dataframe(shown, hide_index=True, use_container_width=True, height=420)

    with sub_s:
        df = _q(
            "SELECT code, min_size, duty, description, related_docs, legal_basis "
            "FROM size_threshold_duty "
            "ORDER BY "
            "CASE min_size "
            "  WHEN '1인 이상' THEN 1 WHEN '5인 이상' THEN 5 "
            "  WHEN '10인 이상' THEN 10 WHEN '30인 이상' THEN 30 "
            "  WHEN '50인 이상' THEN 50 ELSE 999 END, code"
        )
        if df.empty:
            st.info("시드 데이터 없음.")
        else:
            sizes = df["min_size"].value_counts().sort_index().to_dict()
            cols = st.columns(min(max(len(sizes), 1), 5))
            for i, (sz, n) in enumerate(sizes.items()):
                cols[i % len(cols)].metric(sz, int(n))
            st.write("")
            card_open(
                f"규모별 의무  ·  {len(df)}건",
                caption="SIZE_RANK 누적 — API `/guide/by-size/{N인 이상}` 은 본인 규모 이하 모두 반환",
            )
            sz_filter = st.multiselect(
                "규모 필터",
                options=df["min_size"].unique().tolist(),
                default=df["min_size"].unique().tolist(),
                key="g_sz_filter",
            )
            shown = df[df["min_size"].isin(sz_filter)]
            st.dataframe(shown, hide_index=True, use_container_width=True, height=420)

    with sub_l:
        df = _q(
            "SELECT code, phase, sub_topic, requirement, related_docs, "
            "timing, legal_basis "
            "FROM employment_lifecycle "
            "ORDER BY phase, code"
        )
        if df.empty:
            st.info("시드 데이터 없음.")
        else:
            phases = df["phase"].value_counts().to_dict()
            cols = st.columns(min(max(len(phases), 1), 5))
            for i, (ph, n) in enumerate(phases.items()):
                cols[i % len(cols)].metric(ph, int(n))
            st.write("")
            card_open(
                f"고용 생애주기  ·  {len(df)}건",
                caption="채용 → 근로 중 → 종료 → 사후 — 단계별 요구사항",
            )
            st.dataframe(df, hide_index=True, use_container_width=True, height=420)


# ───────────────────────────────────────────────────────
# 3) 💰 계산 공식
# ───────────────────────────────────────────────────────
with tab_calc:
    df = _q(
        "SELECT code, category, calc_name, formula, conditions, limits, "
        "legal_basis, related_violation_code "
        "FROM wage_calc_formula "
        "ORDER BY category, code"
    )
    if df.empty:
        st.info("시드 데이터 없음.")
    else:
        # 룰엔진 연계 검증 — V001~V010 매핑 카운트
        df_linked = df[df["related_violation_code"].notna()]
        c1, c2, c3 = st.columns(3)
        c1.metric("공식 총수", len(df))
        c2.metric("룰엔진 V코드 연계", f"{len(df_linked):,}")
        c3.metric(
            "카테고리",
            df["category"].nunique() if "category" in df else 0,
        )
        st.write("")

        if not df_linked.empty:
            card_open(
                "룰엔진 V001~V010 ↔ 임금 공식 cross-link",
                caption="검토 결과 페이지에서 위반 항목 클릭 시 → 가이드 공식으로 직링크",
            )
            st.dataframe(
                df_linked[
                    ["related_violation_code", "code", "calc_name", "formula", "legal_basis"]
                ],
                hide_index=True,
                use_container_width=True,
            )
            st.write("")

        card_open(
            f"전체 임금 계산 공식  ·  {len(df)}건",
            caption="공식 · 조건 · 한도 · 근거 법령",
        )
        st.dataframe(df, hide_index=True, use_container_width=True, height=420)


# ───────────────────────────────────────────────────────
# 4) 📄 표준 서식
# ───────────────────────────────────────────────────────
with tab_form:
    df = _q(
        "SELECT code, category, form_name, submitter, submit_to, "
        "submit_method, deadline, audience, download_url, legal_basis "
        "FROM form_template "
        "WHERE excluded_from_service = 0 "
        "ORDER BY category, code"
    )
    if df.empty:
        st.info("시드 데이터 없음.")
    else:
        # audience 분포
        aud = df["audience"].value_counts().to_dict()
        with_url = df["download_url"].notna() & (df["download_url"] != "")
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("서식 총수", len(df))
        c2.metric("employer", aud.get("employer", 0))
        c3.metric("both", aud.get("both", 0))
        c4.metric("공식 URL 보유", int(with_url.sum()))

        st.write("")

        if not with_url.all():
            n_missing = int((~with_url).sum())
            st.warning(
                f"⏳ 공식 URL 미입력 서식 {n_missing}건 — Phase 18 에서 고용노동부 자료실 URL 으로 채울 예정"
            )

        card_open(
            f"표준 서식  ·  {len(df)}건",
            caption="자율점검용 — 분쟁·진정 서식(FRM020~FRM024)은 시드 단계에서 완전 제외",
        )
        st.dataframe(df, hide_index=True, use_container_width=True, height=420)


# ───────────────────────────────────────────────────────
# 5) 📖 용어 · 가이드
# ───────────────────────────────────────────────────────
with tab_glossary:
    sub_g, sub_i = st.tabs(["📖 용어 사전 (glossary)", "📚 가이드 항목 (guide_item)"])

    with sub_g:
        df = _q(
            "SELECT code, term, short_def, full_def, confusable_with, legal_basis "
            "FROM guide_glossary "
            "ORDER BY code"
        )
        if df.empty:
            st.info("시드 데이터 없음.")
        else:
            card_open(
                f"용어 사전  ·  {len(df)}건",
                caption="통상임금·평균임금·최저임금 등 혼동 용어 정리",
            )
            keyword = st.text_input(
                "용어 검색", value="", placeholder="예: 통상임금, 평균임금", key="g_gloss_kw"
            )
            shown = df
            if keyword:
                mask = (
                    df["term"].str.contains(keyword, case=False, na=False)
                    | df["short_def"].str.contains(keyword, case=False, na=False)
                    | df["full_def"].str.contains(keyword, case=False, na=False)
                )
                shown = df[mask]
            st.dataframe(shown, hide_index=True, use_container_width=True, height=420)

    with sub_i:
        df = _q(
            "SELECT code, audience, category, title, priority, "
            "applies_under_5, key_points, related_laws "
            "FROM guide_item "
            "WHERE excluded_from_service = 0 "
            "ORDER BY priority, code"
        )
        if df.empty:
            st.info("시드 데이터 없음.")
        else:
            pri = df["priority"].value_counts().to_dict()
            cols = st.columns(min(max(len(pri), 1), 4))
            for i, (p, n) in enumerate(pri.items()):
                cols[i % len(cols)].metric(f"우선순위 {p}", int(n))
            st.write("")

            card_open(
                f"가이드 항목  ·  {len(df)}건",
                caption="`/guide` 페이지의 메인 콘텐츠 — 사업주가 알아두면 좋은 노무 팁",
            )
            st.dataframe(df, hide_index=True, use_container_width=True, height=420)


# ───────────────────────────────────────────────────────
# 6) 🏛 정부 기관
# ───────────────────────────────────────────────────────
with tab_org:
    df = _q(
        "SELECT code, org_class, org_name, duties, common_cases, "
        "phone, online_channel, jurisdiction "
        "FROM gov_org "
        "WHERE excluded_from_service = 0 "
        "ORDER BY org_class, code"
    )
    if df.empty:
        st.info("시드 데이터 없음.")
    else:
        cls = df["org_class"].value_counts().to_dict()
        cols = st.columns(min(max(len(cls), 1), 5))
        for i, (c, n) in enumerate(cls.items()):
            cols[i % len(cols)].metric(c, int(n))
        st.write("")
        card_open(
            f"정부 기관·온라인 채널  ·  {len(df)}건",
            caption="자율점검용 안내 채널 — 노동위원회·검찰 등 분쟁 기관은 시드에서 제외",
        )
        st.dataframe(df, hide_index=True, use_container_width=True, height=420)


# ───────────────────────────────────────────────────────
# 7) 📂 비치 서류
# ───────────────────────────────────────────────────────
with tab_docs:
    df = _q(
        "SELECT code, classification, doc_name, description, "
        "prep_time, retention_period, legal_basis, penalty "
        "FROM required_document "
        "ORDER BY classification, code"
    )
    if df.empty:
        st.info("시드 데이터 없음.")
    else:
        cls = df["classification"].value_counts().to_dict()
        cols = st.columns(min(max(len(cls), 1), 5))
        for i, (c, n) in enumerate(cls.items()):
            cols[i % len(cols)].metric(c, int(n))
        st.write("")
        card_open(
            f"비치·보존 서류  ·  {len(df)}건",
            caption="근로기준법상 작성·비치·보존 의무 서류",
        )
        st.dataframe(df, hide_index=True, use_container_width=True, height=420)


# ───────────────────────────────────────────────────────
# 8) 🎯 채용 · 감사
# ───────────────────────────────────────────────────────
with tab_audit:
    sub_r, sub_a = st.tabs(["🎯 채용 컴플라이언스", "🔍 감사 가이드"])

    with sub_r:
        df = _q(
            "SELECT code, stage, duty, description, violation_examples, "
            "penalty, applies_to, legal_basis, checkpoint "
            "FROM recruit_compliance "
            "ORDER BY stage, code"
        )
        if df.empty:
            st.info("시드 데이터 없음.")
        else:
            stages = df["stage"].value_counts().to_dict()
            cols = st.columns(min(max(len(stages), 1), 5))
            for i, (s, n) in enumerate(stages.items()):
                cols[i % len(cols)].metric(s, int(n))
            st.write("")
            card_open(
                f"채용 단계별 컴플라이언스  ·  {len(df)}건",
                caption="공고 → 면접 → 채용 결정 단계의 차별·정보 수집 금지 등",
            )
            st.dataframe(df, hide_index=True, use_container_width=True, height=420)

    with sub_a:
        df = _q(
            "SELECT code, kind, name, step_no, timing, description, "
            "period_covered, legal_basis "
            "FROM audit_guide "
            "ORDER BY kind, step_no, code"
        )
        if df.empty:
            st.info("시드 데이터 없음.")
        else:
            kinds = df["kind"].value_counts().to_dict()
            cols = st.columns(min(max(len(kinds), 1), 4))
            for i, (k, n) in enumerate(kinds.items()):
                cols[i % len(cols)].metric(k, int(n))
            st.write("")
            card_open(
                f"감사 종류·절차  ·  {len(df)}건",
                caption="근로감독·임금체계 진단 등 — 사업주가 사전 점검에 활용",
            )
            st.dataframe(df, hide_index=True, use_container_width=True, height=420)
