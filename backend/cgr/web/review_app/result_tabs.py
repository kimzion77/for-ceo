"""검토 결과 화면 — 9개 탭 (5-Bucket + 조별·선택·리포트·다운로드).

호출: `render_result_view(report, md_text, uploaded_name, elapsed)`
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

import streamlit as st

from cgr.models import Report
from cgr.penalty_parser import format_for_user
from cgr.reporter import _format_expected, _format_value
from cgr.topic_db import get_topic_db
from cgr.ui import BUCKET_HELP, OVERALL_EMOJI
from cgr.verdict import classify
from cgr.web.review_app.help_text import BUCKET_HELP_TABLE


def render_result_view(
    report: Report,
    md_text: str,
    uploaded_name: str,
    elapsed: float,
) -> None:
    """검토 완료 후 종합 카드 + 9탭 렌더."""
    _render_overall_card(report, elapsed)

    with st.expander("ℹ️ 분류 기준 — 위반·누락·주의의 차이"):
        st.markdown(BUCKET_HELP_TABLE)

    all_findings = [(ar, f) for ar in report.article_results for f in ar.findings]
    n_optional = len(report.optional_displays)
    bucket_counts = {k: report.summary.get(k, 0) for k in ("누락", "위반", "주의", "검토필요", "적정")}

    tabs = st.tabs([
        f"🔴 누락 ({bucket_counts['누락']})",
        f"🟠 위반 ({bucket_counts['위반']})",
        f"🟡 주의 ({bucket_counts['주의']})",
        f"🟣 검토필요 ({bucket_counts['검토필요']})",
        f"✅ 적정 ({bucket_counts['적정']})",
        "📊 조별 요약",
        f"📋 선택 조항 ({n_optional})",
        "📝 전체 리포트",
        "📥 다운로드",
    ])

    for i, bucket in enumerate(["누락", "위반", "주의", "검토필요", "적정"]):
        with tabs[i]:
            _render_bucket_tab(bucket, all_findings)

    with tabs[5]:
        _render_article_summary(report)
    with tabs[6]:
        _render_optional_displays(report)
    with tabs[7]:
        st.markdown(md_text, unsafe_allow_html=False)
    with tabs[8]:
        _render_download(report, md_text, uploaded_name)


# ════════════════════════════════════════
# 종합 판정 카드 + 5-Bucket 메트릭
# ════════════════════════════════════════
def _render_overall_card(report: Report, elapsed: float) -> None:
    label = report.overall_label or "—"
    label_color = OVERALL_EMOJI.get(label, "⚪")
    st.markdown(f"## {label_color} 종합 판정: **{label}**")

    miss_n = report.summary.get("누락", 0)
    viol_n = report.summary.get("위반", 0)
    warn_n = report.summary.get("주의", 0)
    amb_n = report.summary.get("검토필요", 0)
    ok_n = report.summary.get("적정", 0)

    cols = st.columns(5)
    cols[0].metric("🔴 누락", miss_n, help=BUCKET_HELP["누락"])
    cols[1].metric("🟠 위반", viol_n, help=BUCKET_HELP["위반"])
    cols[2].metric("🟡 주의", warn_n, help=BUCKET_HELP["주의"])
    cols[3].metric("🟣 검토필요", amb_n, help=BUCKET_HELP["검토필요"])
    cols[4].metric("✅ 적정", ok_n, help=BUCKET_HELP["적정"])

    st.caption(
        f"⏱ 처리 시간: {elapsed:.1f}s · "
        f"{len(report.article_results)}개 필수 조 검사 / "
        f"{len(report.optional_displays)}개 선택 조 디스플레이"
    )


# ════════════════════════════════════════
# 버킷별 탭 (5-Bucket 동일 렌더)
# ════════════════════════════════════════
def _render_bucket_tab(bucket_name: str, all_findings: list) -> None:
    items = [(ar, f) for ar, f in all_findings if classify(f) == bucket_name]
    if not items:
        st.info("해당 항목 없음.")
        return

    # 조 단위 그룹화
    by_art: dict[int, list] = {}
    for ar, f in items:
        by_art.setdefault(ar.article, []).append((ar, f))

    for art_no in sorted(by_art):
        ar_first = by_art[art_no][0][0]
        st.markdown(f"### 제{art_no}조 — {ar_first.title}")
        for _, f in by_art[art_no]:
            _render_slot_card(f, bucket_name)


def _render_slot_card(f, bucket_name: str) -> None:
    """슬롯 1건 카드 렌더 (5개 섹션: 사유·인용·벌칙·시정·메타)."""
    expanded_default = bucket_name != "적정"
    with st.expander(f"`{f.slot_id}` · {bucket_name}", expanded=expanded_default):
        _slot_section_reason(f, bucket_name)
        _slot_section_quote(f, bucket_name)
        _slot_section_penalty(f)
        _slot_section_fix(f)
        _slot_section_topics(f)
        _slot_section_debug(f)


def _slot_section_reason(f, bucket_name: str) -> None:
    st.markdown("**📝 사유**")
    if bucket_name == "적정":
        # LLM 부정 표현 노출 회피 — 단순화
        master_v = f.expected.value if f.expected else None
        if master_v is False:
            st.markdown("본문에 부적정 표현(구법 잔존 등)이 없어 적정합니다.")
        elif f.extracted.quote:
            st.markdown("본문에 관련 규정이 명시되어 있습니다.")
        else:
            st.markdown("임의 규정 — 본문 미기재 가능 (해당사항 없음).")
    else:
        st.markdown(f.user_reason or f.reason)
    st.markdown("")


def _slot_section_quote(f, bucket_name: str) -> None:
    if f.extracted.quote:
        st.markdown("**📌 인용 (사업장 본문)**")
        st.markdown(f"> {f.extracted.quote[:500]}")
        st.markdown("")
    elif bucket_name == "누락":
        st.markdown("**📌 인용 (사업장 본문)**")
        st.markdown("> 🟥 **본문에서 관련 규정을 찾지 못하였습니다**")
        st.markdown("")
    elif bucket_name == "적정":
        # 임의 규정 미기재 OK — 별도 표기 없음
        pass
    else:
        st.markdown("**📌 인용 (사업장 본문)**")
        st.markdown("> _본문 인용 없음_")
        st.markdown("")


def _slot_section_penalty(f) -> None:
    if not f.penalty:
        return
    parts = format_for_user(f.penalty)
    if parts["omission"] or parts["violation"]:
        st.markdown("**⚖️ 근거 법령 및 벌칙**")
    if parts["omission"]:
        st.markdown("📋 *취업규칙에 **미기재** 시 (필수기재 위반 — 행정 책임)*")
        for p in parts["omission"]:
            st.markdown(f"- {p}")
        st.markdown("")
    if parts["violation"]:
        st.markdown("⚖️ *법령 내용 **위반** 시 (실체 위반 — 형사·과태료)*")
        for p in parts["violation"]:
            st.markdown(f"- {p}")
        st.markdown("")
    if not parts["omission"] and not parts["violation"]:
        st.markdown("**📌 적용 벌칙**")
        for p in f.penalty:
            st.markdown(f"- {p}")
        st.markdown("")


def _slot_section_fix(f) -> None:
    if f.fix_example:
        st.markdown("**✏️ 시정 예시**")
        st.markdown(f"> {f.fix_example}")
        st.markdown("")


def _slot_section_topics(f) -> None:
    tm_list = st.session_state.get("_slot_topic_meta", {}).get(f.slot_id, [])
    if not tm_list:
        return
    tdb = get_topic_db()
    st.markdown("**📚 연관 주제 (메타데이터)**")
    cols = st.columns(min(len(tm_list), 4))
    for idx, tm in enumerate(tm_list):
        section = tdb.lookup(tm)
        col = cols[idx % len(cols)]
        if section:
            title_short = (section.get("title") or "")[:30]
            with col.popover(f"📖 {tm}"):
                st.markdown(f"**{tm}** — {title_short}")
                st.markdown("---")
                st.markdown(section.get("content") or "_(내용 없음)_")
                if section.get("approx"):
                    st.caption("⚠️ 정확한 섹션 매칭 실패 — 가까운 섹션 표시")
        else:
            col.caption(f"📖 `{tm}` (데이터 없음)")
    st.markdown("")


def _slot_section_debug(f) -> None:
    ext = _format_value(f.extracted.extracted_value)
    exp = _format_expected(f.expected)
    tech = ""
    if f.user_reason and f.reason and f.user_reason != f.reason:
        tech = f" · 기술적 사유: `{f.reason}`"
    st.caption(f"🔧 추출값 {ext} · 기준값 {exp}{tech}")


# ════════════════════════════════════════
# 조별 요약 표
# ════════════════════════════════════════
def _render_article_summary(report: Report) -> None:
    summary_rows = []
    for ar in report.article_results:
        cnt = {b: sum(1 for f in ar.findings if classify(f) == b) for b in ("누락", "위반", "주의", "검토필요", "적정")}
        er = sum(1 for f in ar.findings if f.status == "ERROR")
        summary_rows.append({
            "조": f"제{ar.article}조",
            "제목": ar.title,
            "범위": ar.scope or "-",
            "슬롯 수": len(ar.findings),
            "🔴 누락": cnt["누락"],
            "🟠 위반": cnt["위반"],
            "🟡 주의": cnt["주의"],
            "🟣 검토필요": cnt["검토필요"],
            "✅ 적정": cnt["적정"],
            "⚠️ 오류": er,
        })
    st.dataframe(summary_rows, use_container_width=True, hide_index=True)


# ════════════════════════════════════════
# 선택 조항 디스플레이
# ════════════════════════════════════════
def _render_optional_displays(report: Report) -> None:
    if not report.optional_displays:
        st.info("선택 조항 디스플레이 데이터가 없습니다.")
        return
    st.caption(
        "**선택 조항은 검토 AI가 적정/부적정을 판정하지 않습니다.** "
        "마스터 DB의 작성시 착안사항·참고와 사업장 본문 인용을 함께 제공하니, "
        "감독관 판단의 보조 자료로 활용해 주세요."
    )
    present = [od for od in report.optional_displays if od.user_present]
    absent = [od for od in report.optional_displays if not od.user_present]
    sub = st.tabs([
        f"📄 사업장에 규정 있음 ({len(present)})",
        f"🔍 사업장에 규정 없음 ({len(absent)})",
    ])

    def _render_list(items):
        for od in items:
            with st.expander(f"제{od.article}조 — {od.title}"):
                if od.user_quote:
                    st.markdown("**📌 사업장 인용**")
                    st.markdown(f"> {od.user_quote[:500]}")
                    st.markdown("")
                if od.master_guide:
                    st.markdown("**📋 작성시 착안사항**")
                    st.markdown(od.master_guide)
                    st.markdown("")
                if od.master_note:
                    st.markdown("**📌 참고**")
                    st.markdown(od.master_note)
                    st.markdown("")
                if od.master_body:
                    with st.popover("📖 표준 본문 (마스터 D열) 보기"):
                        st.markdown(od.master_body)

    with sub[0]:
        if not present:
            st.info("해당 항목 없음.")
        else:
            _render_list(present)
    with sub[1]:
        if not absent:
            st.info("해당 항목 없음.")
        else:
            _render_list(absent)


# ════════════════════════════════════════
# 다운로드
# ════════════════════════════════════════
def _render_download(report: Report, md_text: str, uploaded_name: str) -> None:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_name = Path(uploaded_name).stem
    st.download_button(
        "📄 마크다운 다운로드",
        data=md_text.encode("utf-8"),
        file_name=f"report_{base_name}_{ts}.md",
        mime="text/markdown",
    )
    st.download_button(
        "📦 JSON 다운로드",
        data=report.model_dump_json(indent=2).encode("utf-8"),
        file_name=f"report_{base_name}_{ts}.json",
        mime="application/json",
    )
