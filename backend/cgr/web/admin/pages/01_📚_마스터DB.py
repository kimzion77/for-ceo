"""통합 마스터 DB 대시보드 (read-only).

프론트엔드(`/frontend`) 의 civic 디자인 토큰을 그대로 이식 — Pretendard, 네이비 #0B3D91,
14px 라운드 카드, sm 그림자.

레이아웃
  ┌────────────────────────────────────────────────────────┐
  │  Hero  (그라데이션 — 파일경로 · 마지막 갱신)              │
  ├────────────────────────────────────────────────────────┤
  │  KPI strip × 6  (슬롯·주제·법령·조문·검토·OPEN)          │
  ├────────────────────────────────────────────────────────┤
  │  Pill 탭 6개                                            │
  │  ─ 📊 개요  ─ 🔎 데이터  ─ 🧩 슬롯  ─ 🔗 매핑           │
  │  ─ 💰 룰    ─ 📋 검토                                  │
  ├────────────────────────────────────────────────────────┤
  │  본문 (각 탭) — 카드 단위로 그룹                         │
  └────────────────────────────────────────────────────────┘

설계 문서: 임금명세서_DB모델링_설계.md (Phase 6·7 통합)
"""
from __future__ import annotations

import json
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
    page_title="통합 마스터 DB",
    page_icon="🗄",
    layout="wide",
    initial_sidebar_state="expanded",
)
# 테마는 로그인 화면에도 적용되도록 require_login 전에 inject.
inject_civic_theme()
require_login()


# ─── 공통 헬퍼 ──────────────────────────────────────────
@st.cache_data(ttl=30)
def _table_counts() -> dict[str, int]:
    return _db.table_counts()


@st.cache_data(ttl=30)
def _query(sql: str, params: tuple = ()) -> pd.DataFrame:
    with _db.connect() as conn:
        cur = conn.execute(sql, params)
        cols = [d[0] for d in cur.description] if cur.description else []
        rows = [list(r) for r in cur.fetchall()]
    return pd.DataFrame(rows, columns=cols)


@st.cache_data(ttl=30)
def _list_tables_and_views() -> list[str]:
    with _db.connect() as conn:
        cur = conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' "
            "ORDER BY type DESC, name"
        )
        return [r["name"] for r in cur.fetchall()]


# ─── Hero + 글로벌 KPI strip ────────────────────────────
hero(
    title="통합 마스터 DB",
    subtitle=f"{_db.get_db_path()}  ·  Phase 1~7 통합 · 27 테이블 + 2 뷰",
    icon="🗄",
)

counts = _table_counts()

# 글로벌 KPI — 자율점검 서비스 전체 한눈에
c1, c2, c3, c4, c5, c6 = st.columns(6)
c1.metric("슬롯 (check_item)", f"{counts.get('check_item', 0):,}")
c2.metric("주제 섹션", f"{counts.get('topic_section', 0):,}")
c3.metric("법령 조문", f"{counts.get('law_article', 0):,}")
c4.metric("임금항목 카탈로그", f"{counts.get('wage_item_catalog', 0):,}")
c5.metric(
    "검토 실행",
    f"{counts.get('inspection_run', 0):,}",
    help="Phase 7 — payslip 기반 룰엔진 실행 누계",
)
open_n = _query(
    "SELECT COUNT(*) AS n FROM violation_finding WHERE status='OPEN'"
)
c6.metric(
    "OPEN 위반",
    f"{int(open_n['n'].iloc[0]):,}" if not open_n.empty else "0",
    help="아직 시정되지 않은 위반",
)

st.write("")

# ─── Pill 탭 ────────────────────────────────────────────
tab_summary, tab_browser, tab_slot, tab_mapping, tab_rules, tab_history = st.tabs(
    [
        "📊 개요",
        "🔎 데이터 브라우저",
        "🧩 슬롯 풀 컨텍스트",
        "🔗 매핑 검증",
        "💰 계산형 룰",
        "📋 검토 이력",
    ]
)


# ───────────────────────────────────────────────────────
# 1) 📊 개요
# ───────────────────────────────────────────────────────
with tab_summary:
    # 좌: 도메인 분포 / 우: 테이블 분류
    col_l, col_r = st.columns([1.1, 1])

    with col_l:
        card_open(
            "도메인 분포",
            caption="문서·주제·법령 — 마스터 reference 데이터의 분포",
        )
        sub_doc, sub_topic, sub_law = st.tabs(["문서별 슬롯", "주제 (상위 12)", "법령별 조문"])
        with sub_doc:
            df_doc = _query(
                "SELECT dt.name AS document, COUNT(ci.id) AS 슬롯수 "
                "FROM document_type dt "
                "LEFT JOIN check_item ci ON ci.document_type_id = dt.id "
                "GROUP BY dt.id ORDER BY 슬롯수 DESC"
            )
            st.dataframe(df_doc, hide_index=True, use_container_width=True)
        with sub_topic:
            df_topic = _query(
                "SELECT t.name AS topic, COUNT(ts.id) AS 섹션 "
                "FROM topic t "
                "LEFT JOIN topic_section ts ON ts.topic_id = t.id "
                "GROUP BY t.id ORDER BY 섹션 DESC LIMIT 12"
            )
            st.dataframe(df_topic, hide_index=True, use_container_width=True)
        with sub_law:
            df_law = _query(
                "SELECT l.code AS 법령, COUNT(la.id) AS 조문 "
                "FROM law l "
                "LEFT JOIN law_article la ON la.law_id = l.id "
                "GROUP BY l.id ORDER BY 조문 DESC"
            )
            st.dataframe(df_law, hide_index=True, use_container_width=True)

    with col_r:
        card_open(
            "테이블 행 수 (전체 27)",
            count=len(counts),
            caption="reference · 트랜잭션 · 검토 도메인 구분",
        )
        # priority 정렬 + 그룹화 표시
        groups = {
            "📚 정규화 마스터": [
                "document_type", "topic", "topic_section", "law", "law_article",
            ],
            "🧩 슬롯": [
                "check_item", "check_item_applicability", "check_item_risk",
                "check_item_topic", "check_item_law",
            ],
            "💰 계산형 룰": [
                "minimum_wage_master", "wage_item_catalog",
                "violation_type", "recommendation_mapping",
            ],
            "📋 트랜잭션": [
                "workplace", "employee",
                "payslip_document", "payslip_ocr_raw", "payslip", "payslip_line",
                "llm_judgment", "inspection_run", "violation_finding",
                "recommendation", "correction_log",
            ],
            "🗄 검토 (Phase 1~5 호환)": [
                "audit_case", "audit_finding",
            ],
        }
        for group_name, table_list in groups.items():
            rows = [(t, counts[t]) for t in table_list if t in counts]
            if not rows:
                continue
            with st.expander(
                f"{group_name}  ·  {len(rows)} 테이블 / 총 {sum(n for _, n in rows):,} 행"
            ):
                df = pd.DataFrame(rows, columns=["테이블", "행 수"])
                st.dataframe(df, hide_index=True, use_container_width=True)


# ───────────────────────────────────────────────────────
# 2) 🔎 데이터 브라우저
# ───────────────────────────────────────────────────────
with tab_browser:
    names = _list_tables_and_views()
    if not names:
        st.error("DB 가 비어있습니다.")
    else:
        card_open(
            "테이블 / 뷰 미리보기",
            caption="text 컬럼에 LIKE 검색. LIMIT 으로 행 수 제한.",
        )
        col_a, col_b, col_c = st.columns([2, 3, 1])
        with col_a:
            chosen = st.selectbox("테이블 / 뷰", names, key="mdb_browse_table")
        with col_b:
            keyword = st.text_input(
                "검색어 (text 컬럼 LIKE)",
                value="",
                placeholder="예: 임금, 제17조, DB_근로시간",
                key="mdb_keyword",
            )
        with col_c:
            limit = st.number_input(
                "최대 행", min_value=10, max_value=2000, value=200, step=10
            )

        with _db.connect() as conn:
            info = conn.execute(f"PRAGMA table_info({chosen})").fetchall()
        text_cols = [r["name"] for r in info if str(r["type"]).upper() in ("TEXT",)]

        where_sql = ""
        params: tuple = ()
        if keyword and text_cols:
            ors = " OR ".join(f"{c} LIKE ?" for c in text_cols)
            where_sql = f"WHERE {ors}"
            params = tuple(f"%{keyword}%" for _ in text_cols)

        df = _query(
            f"SELECT * FROM {chosen} {where_sql} LIMIT ?",
            params + (int(limit),),
        )
        stat_row(
            ("결과", f"{len(df):,}행"),
            ("LIMIT", f"{int(limit):,}"),
            ("text 컬럼", str(len(text_cols))),
        )
        st.dataframe(df, hide_index=True, use_container_width=True, height=540)


# ───────────────────────────────────────────────────────
# 3) 🧩 슬롯 풀 컨텍스트
# ───────────────────────────────────────────────────────
with tab_slot:
    card_open(
        "슬롯 한 건의 풀 컨텍스트",
        caption="`v_check_item_full` 뷰 — 적용조건·위험도·연관 주제·법령 조문 한 화면",
    )
    df_docs = _query("SELECT id, code, name FROM document_type ORDER BY id")
    if df_docs.empty:
        st.warning("document_type 비어있음.")
    else:
        col1, col2 = st.columns(2)
        with col1:
            doc_code = st.selectbox(
                "문서",
                df_docs["code"].tolist(),
                key="mdb_slot_doc",
                format_func=lambda c: f"{c} · "
                f"{df_docs.loc[df_docs.code == c, 'name'].values[0]}",
            )
        df_slots = _query(
            "SELECT ci.id, ci.code, ci.name, ci.category "
            "FROM check_item ci JOIN document_type dt ON dt.id = ci.document_type_id "
            "WHERE dt.code = ? ORDER BY ci.display_order, ci.id",
            (doc_code,),
        )
        with col2:
            if df_slots.empty:
                st.info("해당 문서에 슬롯이 없습니다.")
                slot_code = None
            else:
                slot_code = st.selectbox(
                    "슬롯",
                    df_slots["code"].tolist(),
                    key="mdb_slot_pick",
                    format_func=lambda c: f"{c} · "
                    f"{df_slots.loc[df_slots.code == c, 'name'].values[0]}",
                )

        if slot_code:
            full = _query(
                "SELECT * FROM v_check_item_full WHERE slot_code = ? AND document_type = ?",
                (slot_code, doc_code),
            )
            if full.empty:
                st.warning("뷰 결과 없음 — seed 미완료?")
            else:
                row = full.iloc[0]
                # 슬롯 헤더 — 메타와 위험도 chip
                missing_sev = row.get("missing_severity") or "MID"
                viol_sev = row.get("violation_severity") or "MID"

                def _to_chip(sev: str) -> str:
                    mapping = {"HIGH": "high", "CRITICAL": "high", "MEDIUM": "mid",
                               "MID": "mid", "LOW": "low"}
                    return risk_chip(mapping.get(sev.upper(), "low"), sev)

                st.markdown(
                    '<div style="background:#E5ECF8;border:1px solid #0B3D91;'
                    'border-radius:14px;padding:16px 20px;margin-bottom:14px;'
                    'box-shadow:0 1px 2px rgba(15,27,45,0.04);">'
                    f'<div style="font-size:11px;color:#0B3D91;font-weight:700;letter-spacing:0.5px;">'
                    f"{row['document_type']}  ·  {row.get('category') or '—'}"
                    '</div>'
                    f'<div style="font-size:19px;font-weight:700;margin-top:4px;color:#0F1B2D;">'
                    f"{row['item_name']}"
                    '</div>'
                    f'<div style="font-size:11px;color:#7B8794;font-family:D2Coding,ui-monospace,monospace;margin-top:2px;">'
                    f"{row['slot_code']}"
                    '</div>'
                    '<div style="margin-top:10px;">'
                    f'<span style="font-size:11px;color:#475569;">미기재</span> {_to_chip(missing_sev)}'
                    '&nbsp;&nbsp;'
                    f'<span style="font-size:11px;color:#475569;">부적절</span> {_to_chip(viol_sev)}'
                    '</div>'
                    '</div>',
                    unsafe_allow_html=True,
                )

                col_l, col_r = st.columns(2)
                with col_l:
                    if row.get("required_content"):
                        section_header("기재 내용", "")
                        st.write(row["required_content"])
                    if row.get("purpose"):
                        section_header("기재 필요 이유", "")
                        st.write(row["purpose"])
                with col_r:
                    if row.get("fix_example"):
                        section_header("개선 예시", "")
                        st.info(row["fix_example"])

                df_app = _query(
                    "SELECT business_size, worker_types, written_duty "
                    "FROM check_item_applicability WHERE check_item_id = ?",
                    (int(row["check_item_id"]),),
                )
                section_header("적용 조건", "")
                if df_app.empty:
                    st.caption("— 모든 사업장·근로유형 적용")
                else:
                    st.dataframe(df_app, hide_index=True, use_container_width=True)

                topic_refs = json.loads(row.get("topic_refs_json") or "[]")
                law_refs = json.loads(row.get("law_refs_json") or "[]")
                col_t, col_l = st.columns(2)
                with col_t:
                    section_header(
                        f"연관 주제 섹션 ({len(topic_refs)})",
                        "노무사회 코퍼스 본문 + section_no",
                    )
                    if topic_refs:
                        st.dataframe(
                            pd.DataFrame(topic_refs),
                            hide_index=True,
                            use_container_width=True,
                            height=300,
                        )
                    else:
                        st.caption("— 매핑 없음")
                with col_l:
                    section_header(
                        f"관련 법령 조문 ({len(law_refs)})",
                        "law.go.kr 직링크 포함",
                    )
                    if law_refs:
                        st.dataframe(
                            pd.DataFrame(law_refs),
                            hide_index=True,
                            use_container_width=True,
                            height=300,
                        )
                    else:
                        st.caption("— 매핑 없음")


# ───────────────────────────────────────────────────────
# 4) 🔗 매핑 검증
# ───────────────────────────────────────────────────────
with tab_mapping:
    card_open(
        "매핑 누락 점검",
        caption="모든 슬롯에 주제·법령·위험도가 채워졌는지 검증",
    )
    df_no_topic = _query(
        "SELECT dt.code AS document, ci.code AS slot_code, ci.name AS slot_name "
        "FROM check_item ci JOIN document_type dt ON dt.id = ci.document_type_id "
        "LEFT JOIN check_item_topic cit ON cit.check_item_id = ci.id "
        "WHERE cit.check_item_id IS NULL "
        "ORDER BY dt.code, ci.display_order"
    )
    df_no_law = _query(
        "SELECT dt.code AS document, ci.code AS slot_code, ci.name AS slot_name "
        "FROM check_item ci JOIN document_type dt ON dt.id = ci.document_type_id "
        "LEFT JOIN check_item_law cil ON cil.check_item_id = ci.id "
        "WHERE cil.check_item_id IS NULL "
        "ORDER BY dt.code, ci.display_order"
    )
    df_no_risk = _query(
        "SELECT dt.code AS document, ci.code AS slot_code, ci.name AS slot_name "
        "FROM check_item ci JOIN document_type dt ON dt.id = ci.document_type_id "
        "LEFT JOIN check_item_risk cir ON cir.check_item_id = ci.id "
        "WHERE cir.check_item_id IS NULL "
        "ORDER BY dt.code, ci.display_order"
    )

    c1, c2, c3 = st.columns(3)
    c1.metric("주제 매핑 누락", f"{len(df_no_topic):,}")
    c2.metric("법령 매핑 누락", f"{len(df_no_law):,}")
    c3.metric("위험도 미정", f"{len(df_no_risk):,}")

    with st.expander(f"⚠️ 주제 매핑 누락 슬롯 — {len(df_no_topic):,}개"):
        if df_no_topic.empty:
            st.success("모든 슬롯에 주제 매핑이 있습니다.")
        else:
            st.dataframe(df_no_topic, hide_index=True, use_container_width=True)
    with st.expander(f"⚠️ 법령 매핑 누락 슬롯 — {len(df_no_law):,}개"):
        if df_no_law.empty:
            st.success("모든 슬롯에 법령 매핑이 있습니다.")
        else:
            st.dataframe(df_no_law, hide_index=True, use_container_width=True)
    with st.expander(f"⚠️ 위험도 미정 슬롯 — {len(df_no_risk):,}개"):
        if df_no_risk.empty:
            st.success("모든 슬롯의 위험도가 채워져 있습니다.")
        else:
            st.dataframe(df_no_risk, hide_index=True, use_container_width=True)

    st.write("")
    card_open(
        "참조 무결성",
        caption="고아 매핑 — 모두 0 이어야 정상 (FK 강제)",
    )
    df_orphan_topic = _query(
        "SELECT COUNT(*) AS n FROM check_item_topic cit "
        "LEFT JOIN topic_section ts ON ts.id = cit.topic_section_id "
        "WHERE ts.id IS NULL"
    )
    df_orphan_law = _query(
        "SELECT COUNT(*) AS n FROM check_item_law cil "
        "LEFT JOIN law_article la ON la.id = cil.law_article_id "
        "WHERE la.id IS NULL"
    )
    o1, o2 = st.columns(2)
    o1.metric("고아 주제 매핑", int(df_orphan_topic["n"].iloc[0]))
    o2.metric("고아 법령 매핑", int(df_orphan_law["n"].iloc[0]))


# ───────────────────────────────────────────────────────
# 5) 💰 계산형 룰 (Phase 6)
# ───────────────────────────────────────────────────────
with tab_rules:
    # 상단: 현재 적용 최저임금 (강조 카드)
    df_curr = _query("SELECT * FROM v_minimum_wage_current")
    if not df_curr.empty:
        r = df_curr.iloc[0]
        st.markdown(
            '<div style="background:linear-gradient(135deg,#E5ECF8,#fff);'
            'border:1px solid #0B3D91;border-radius:14px;padding:18px 22px;'
            'margin-bottom:20px;box-shadow:0 1px 2px rgba(15,27,45,0.04);">'
            '<div style="display:flex;align-items:center;gap:24px;">'
            '<div>'
            '<div style="font-size:11px;color:#0B3D91;font-weight:700;letter-spacing:0.5px;">'
            '🟢 현재 적용 최저임금'
            '</div>'
            '<div style="font-size:34px;font-weight:700;margin-top:4px;color:#0F1B2D;'
            "font-feature-settings:'tnum';\">"
            f"{int(r['hourly_amount']):,}"
            '<span style="font-size:16px;color:#7B8794;"> 원/h</span>'
            '</div>'
            '<div style="font-size:12px;color:#475569;margin-top:2px;">'
            f"{int(r['year'])}년 · 월 환산 {int(r['monthly_amount_209h']):,}원 (주40h × 4.345주 = 209h)"
            '</div>'
            '</div>'
            '<div style="flex:1;text-align:right;font-size:11.5px;color:#7B8794;">'
            f'<div>발효: <b style="color:#0F1B2D;">{r["effective_from"]}</b></div>'
            f'<div style="margin-top:3px;">출처: {r.get("source") or "—"}</div>'
            '</div>'
            '</div>'
            '</div>',
            unsafe_allow_html=True,
        )

    sub_min, sub_items, sub_violations, sub_recs = st.tabs(
        ["📅 최저임금", "🏷 임금항목 카탈로그", "⚠️ 위반유형", "📝 권고안"]
    )

    # ─── 📅 ───
    with sub_min:
        df = _query(
            "SELECT year, hourly_amount, monthly_amount_209h, "
            "effective_from, effective_to, source "
            "FROM minimum_wage_master ORDER BY year DESC"
        )
        if df.empty:
            st.info("시드 데이터 없음.")
        else:
            card_open(
                f"연도별 최저임금  ·  {len(df)}개년",
                caption="최저임금위원회 매년 8월경 고시 — 월 환산 209h (주40h × 4.345주)",
            )
            st.dataframe(df, hide_index=True, use_container_width=True)

    # ─── 🏷 ───
    with sub_items:
        df = _query(
            "SELECT item_code, item_name, item_category, line_type, "
            "is_ordinary_wage AS 통상임금, is_average_wage AS 평균임금, "
            "is_taxable AS 과세, legal_basis, aliases "
            "FROM wage_item_catalog ORDER BY line_type DESC, item_category, item_code"
        )
        if df.empty:
            st.info("시드 데이터 없음.")
        else:
            # category 별 KPI
            df_cat = df.groupby("item_category").size().reset_index(name="n")
            df_cat = df_cat.sort_values("n", ascending=False)
            cols = st.columns(min(len(df_cat), 5))
            for i, (_, r) in enumerate(df_cat.iterrows()):
                cols[i % len(cols)].metric(r["item_category"], int(r["n"]))
            st.write("")

            card_open(
                f"임금항목 카탈로그  ·  {len(df)}건",
                caption="통상임금 여부는 catalog 기본값 — llm_judgment 패스에서 사업장 실제 운영으로 override",
            )
            only_ord = st.checkbox(
                "통상임금 포함 항목만 보기", value=False, key="mdb_wi_ord"
            )
            shown = df[df["통상임금"] == 1] if only_ord else df
            st.dataframe(
                shown, hide_index=True, use_container_width=True, height=420
            )

    # ─── ⚠️ ───
    with sub_violations:
        df = _query(
            """
            SELECT vt.violation_code, vt.violation_name, vt.severity,
                   vt.judgment_kind,
                   COALESCE(l.code || ' ' || la.article_no ||
                            COALESCE(' ' || la.paragraph_no, '') ||
                            COALESCE(' ' || la.item_no, ''),
                            vt.legal_article, '—') AS 근거법령,
                   vt.penalty
            FROM violation_type vt
            LEFT JOIN law_article la ON la.id = vt.law_article_id
            LEFT JOIN law l ON l.id = la.law_id
            ORDER BY vt.severity DESC, vt.violation_code
            """
        )
        if df.empty:
            st.info("시드 데이터 없음.")
        else:
            # 카드형 KPI
            sev = df["severity"].value_counts().to_dict()
            kind = df["judgment_kind"].value_counts().to_dict()
            c1, c2, c3, c4, c5 = st.columns(5)
            c1.metric("전체", len(df))
            c2.metric("HIGH", sev.get("HIGH", 0))
            c3.metric("MID", sev.get("MID", 0))
            c4.metric("계산형 (rule)", kind.get("rule", 0))
            c5.metric("판단형 (llm)", kind.get("llm", 0))

            st.write("")
            card_open(
                f"위반유형 카탈로그  ·  {len(df)}건",
                caption="V001~V010 · severity 와 judgment_kind 로 룰엔진 분기",
            )
            sev_filter = st.multiselect(
                "severity 필터",
                options=sorted(df["severity"].unique().tolist()),
                default=sorted(df["severity"].unique().tolist()),
                key="mdb_vt_sev",
            )
            shown = df[df["severity"].isin(sev_filter)]

            # severity 컬럼을 chip 형태로 렌더하려면 dataframe → HTML 변환 필요.
            # 표준 dataframe 사용하되, severity 컬럼 너비/정렬 조정.
            st.dataframe(
                shown, hide_index=True, use_container_width=True, height=420
            )

    # ─── 📝 ───
    with sub_recs:
        df = _query(
            """
            SELECT rm.recommendation_id, rm.violation_code,
                   vt.violation_name, vt.severity,
                   rm.priority, rm.recommendation_text
            FROM recommendation_mapping rm
            LEFT JOIN violation_type vt ON vt.violation_code = rm.violation_code
            ORDER BY rm.violation_code, rm.priority
            """
        )
        if df.empty:
            st.info("시드 데이터 없음.")
        else:
            card_open(
                f"권고안 템플릿  ·  {len(df)}건",
                caption="본문의 `{변수}` 자리표시자 — 룰엔진 실행 시 사업장별 값으로 치환",
            )
            st.dataframe(
                df, hide_index=True, use_container_width=True, height=420
            )


# ───────────────────────────────────────────────────────
# 6) 📋 검토 이력 (Phase 7 트랜잭션)
# ───────────────────────────────────────────────────────
with tab_history:
    # 한 줄 KPI
    kpi = _query(
        """
        SELECT
          (SELECT COUNT(*) FROM workplace) AS workplaces,
          (SELECT COUNT(*) FROM employee) AS employees,
          (SELECT COUNT(*) FROM payslip_document) AS documents,
          (SELECT COUNT(*) FROM payslip) AS payslips,
          (SELECT COUNT(*) FROM inspection_run) AS runs,
          (SELECT COUNT(*) FROM violation_finding) AS findings,
          (SELECT COUNT(*) FROM violation_finding WHERE status='OPEN') AS open_findings
        """
    )
    if not kpi.empty:
        r = kpi.iloc[0]
        c1, c2, c3, c4, c5, c6, c7 = st.columns(7)
        c1.metric("사업장", int(r["workplaces"]))
        c2.metric("근로자", int(r["employees"]))
        c3.metric("문서", int(r["documents"]))
        c4.metric("payslip", int(r["payslips"]))
        c5.metric("검토 실행", int(r["runs"]))
        c6.metric("위반 발견", int(r["findings"]))
        c7.metric("OPEN", int(r["open_findings"]))
        st.caption(
            "PII (성명·사번·사업자번호) 는 마스킹 / SHA-256 해시 컬럼으로만 저장됩니다."
        )

    st.write("")

    runs_df = _query(
        """
        SELECT ir.id, ir.run_uid, ir.ruleset_version, ir.minimum_wage_year,
               ir.overall_status, ir.total_violations, ir.executed_at,
               p.worker_name, p.total_gross, p.payment_date,
               w.workplace_name
        FROM inspection_run ir
        JOIN payslip p ON p.id = ir.payslip_id
        JOIN payslip_document pd ON pd.id = p.document_id
        LEFT JOIN workplace w ON w.id = pd.workplace_id
        ORDER BY ir.executed_at DESC
        LIMIT 100
        """
    )
    if runs_df.empty:
        st.info(
            "아직 검토 실행 이력이 없습니다 — "
            "`POST /api/v1/ws/inspect` 를 `persist=true` 로 호출하면 여기 쌓입니다."
        )
    else:
        card_open(
            "최근 검토 실행",
            count=len(runs_df),
            caption="run_uid 별로 drill-down — payslip 라인 + 위반 항목 한 화면",
        )
        st.dataframe(
            runs_df, hide_index=True, use_container_width=True, height=280
        )

        chosen_uid = st.selectbox(
            "상세 보기 — run_uid",
            runs_df["run_uid"].tolist(),
            key="mdb_run_pick",
        )
        if chosen_uid:
            full = _query(
                "SELECT * FROM v_inspection_full WHERE run_uid = ?",
                (chosen_uid,),
            )
            if not full.empty:
                row = full.iloc[0]

                overall = row["overall_status"]
                overall_cls = {
                    "VIOLATION": "high",
                    "WARN": "warn",
                    "OK": "ok",
                }.get(overall, "low")

                st.markdown(
                    '<div style="background:#fff;border:1px solid #DBE2EA;'
                    'border-radius:14px;padding:18px 20px;margin-bottom:14px;'
                    'box-shadow:0 1px 2px rgba(15,27,45,0.04);">'
                    '<div style="display:flex;gap:24px;align-items:flex-start;">'
                    '<div style="flex:1;">'
                    '<div style="font-size:11px;color:#7B8794;'
                    "font-family:D2Coding,ui-monospace,monospace;letter-spacing:0.3px;\">"
                    f"{row['run_uid']}"
                    '</div>'
                    '<div style="font-size:17px;font-weight:700;margin-top:4px;color:#0F1B2D;">'
                    f"{row.get('workplace_name') or '—'}  ·  {row.get('employee_name') or '—'}"
                    '</div>'
                    '<div style="font-size:12px;color:#475569;margin-top:4px;">'
                    f"룰셋 <b style='color:#0F1B2D;'>{row['ruleset_version']}</b>"
                    '<span style="color:#C2CCD8;margin:0 6px;">·</span>'
                    f"최저임금 기준연도 <b style='color:#0F1B2D;'>{row['minimum_wage_year']}</b>"
                    '<span style="color:#C2CCD8;margin:0 6px;">·</span>'
                    f"실행 <b style='color:#0F1B2D;'>{row.get('executed_at') or '—'}</b>"
                    '</div>'
                    '</div>'
                    '<div style="text-align:right;">'
                    f'<div>{risk_chip(overall_cls, overall)}</div>'
                    "<div style=\"font-size:22px;font-weight:700;margin-top:8px;font-feature-settings:'tnum';color:#0F1B2D;\">"
                    f"{int(row['total_violations'])} "
                    '<span style="font-size:12px;font-weight:600;color:#7B8794;">위반</span>'
                    '</div>'
                    '<div style="font-size:12px;color:#7B8794;margin-top:2px;">'
                    f"임금총액 {int(row.get('total_gross') or 0):,}원"
                    '</div>'
                    '</div>'
                    '</div>'
                    '</div>',
                    unsafe_allow_html=True,
                )

                findings = json.loads(row.get("findings_json") or "[]")
                if findings:
                    section_header(
                        f"위반 항목 ({len(findings)})",
                        "severity 순으로 정렬",
                    )
                    # 카드형 위반 리스트 — dataframe 보다 가독성 ↑
                    for f in findings:
                        sev = (f.get("severity") or "MID").upper()
                        sev_cls = {
                            "HIGH": "high", "CRITICAL": "high",
                            "MID": "mid", "MEDIUM": "mid", "LOW": "low",
                        }.get(sev, "low")
                        diff_str = (
                            f"{int(f.get('diff') or 0):,}원"
                            if f.get("diff") else "—"
                        )
                        st.markdown(
                            '<div style="background:#fff;border:1px solid #DBE2EA;'
                            'border-radius:14px;padding:14px 18px;margin-bottom:10px;'
                            'box-shadow:0 1px 2px rgba(15,27,45,0.04);">'
                            '<div style="display:flex;justify-content:space-between;'
                            'align-items:center;gap:16px;">'
                            '<div style="flex:1;">'
                            '<div style="display:flex;align-items:center;gap:10px;">'
                            f'{risk_chip(sev_cls, sev)}'
                            '<span style="font-size:12px;color:#7B8794;'
                            "font-family:D2Coding,ui-monospace,monospace;\">"
                            f"{f['violation']}"
                            '</span>'
                            '<span style="font-size:14.5px;font-weight:700;color:#0F1B2D;">'
                            f"{f.get('name', '')}"
                            '</span>'
                            '</div>'
                            '<div style="font-size:13px;color:#475569;margin-top:8px;line-height:1.6;">'
                            f"{f.get('detail', '')}"
                            '</div>'
                            '<div style="font-size:12px;color:#7B8794;margin-top:6px;">'
                            f"탐지 <b style='color:#0F1B2D;'>{f.get('detected','—')}</b>"
                            '<span style="color:#C2CCD8;margin:0 8px;">→</span>'
                            f"기준 <b style='color:#0F1B2D;'>{f.get('expected','—')}</b>"
                            '</div>'
                            '</div>'
                            '<div style="text-align:right;min-width:120px;">'
                            '<div style="font-size:10px;color:#7B8794;text-transform:uppercase;'
                            'letter-spacing:0.5px;">차액</div>'
                            "<div style=\"font-size:18px;font-weight:700;"
                            "font-feature-settings:'tnum';color:#0F1B2D;\">"
                            f"{diff_str}</div>"
                            '<div style="font-size:10.5px;color:#7B8794;margin-top:2px;">'
                            f"{f.get('status','OPEN')}</div>"
                            '</div>'
                            '</div>'
                            '</div>',
                            unsafe_allow_html=True,
                        )

                payslip_id = int(row["payslip_id"])
                lines_df = _query(
                    "SELECT display_order, line_type, item_code, "
                    "item_name_original, amount, is_ordinary_wage_final "
                    "FROM payslip_line WHERE payslip_id = ? "
                    "ORDER BY line_type DESC, display_order",
                    (payslip_id,),
                )
                if not lines_df.empty:
                    section_header(
                        f"임금 라인 ({len(lines_df)})",
                        "PAYMENT (지급) / DEDUCTION (공제) 정규화 라인",
                    )
                    st.dataframe(
                        lines_df, hide_index=True,
                        use_container_width=True, height=220
                    )
