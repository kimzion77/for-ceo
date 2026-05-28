"""취업규칙 검토 AI — Streamlit 웹 UI.

실행:
    cd <mvp dir>
    streamlit run cgr/web/streamlit_app.py
"""
from __future__ import annotations

import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

# 모듈 상위 경로 등록 (streamlit run 으로 실행 시 cgr 패키지 import 보장)
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import streamlit as st

from cgr import llm_cache
from cgr.config import get_api_key, get_llm_model, get_embed_model
from cgr.master_db import get_master_db
from cgr.models import WorkplaceContext
from cgr.reporter import render_markdown, save_report
from cgr.run import review_file
from cgr.topic_db import get_topic_db


st.set_page_config(
    page_title="취업규칙 검토 AI",
    page_icon="📋",
    layout="wide",
    initial_sidebar_state="expanded",
)


# ─── 사이드바: 환경 정보 ──────────────────────────────────
with st.sidebar:
    st.markdown("### ⚙️ 환경")
    api_key = get_api_key()
    if api_key:
        st.success(f"OpenAI Key: …{api_key[-6:]}")
    else:
        st.error("OpenAI API Key 미설정")
    st.caption(f"LLM 모델: `{get_llm_model()}`")
    st.caption(f"임베딩: `{get_embed_model()}`")

    st.divider()
    st.markdown("### 📚 마스터 DB")
    try:
        db = get_master_db()
        st.success(f"로드 완료 ({len(db.all_articles())}개 조)")
        st.caption(f"경로: `{db.path}`")
    except Exception as e:
        st.error(f"로드 실패: {e}")

    st.divider()
    st.markdown("### 💾 LLM 캐시")
    try:
        cs = llm_cache.stats()
        st.caption(f"항목 {cs['entries']:,}개 · {cs['size_kb']:,} KB")
        if st.button("🗑 캐시 비우기", use_container_width=True):
            n = llm_cache.clear()
            st.success(f"{n}개 삭제")
            st.rerun()
    except Exception as e:
        st.caption(f"캐시 상태 조회 실패: {e}")

    st.divider()
    st.markdown("### 📚 토픽 DB")
    try:
        _tdb = get_topic_db()
        if len(_tdb) > 0:
            st.success(f"{len(_tdb)}개 섹션 / {len(_tdb.topic_names())}개 토픽")
            st.caption(f"경로: `{_tdb.path.name}`")
        else:
            st.warning("토픽 인덱스 비어있음 — scripts/build_topic_index.py 실행 필요")
    except Exception as e:
        st.warning(f"토픽 로드 실패: {e}")

    st.divider()
    st.markdown("### 📋 슬롯 카탈로그")
    catalog_path = _ROOT / "data" / "slots" / "atomic_slots_v0.yaml"
    if catalog_path.exists():
        try:
            from cgr.catalog import load_catalog

            cat = load_catalog(catalog_path)
            from collections import Counter

            comp = Counter(s.comparator for s in cat.slots)
            st.success(f"{len(cat.slots)}개 슬롯")
            for k, v in sorted(comp.items()):
                st.caption(f"`{k}`: {v}")
        except Exception as e:
            st.warning(f"파싱 오류: {e}")
    else:
        st.warning("카탈로그 파일 없음")


# ─── 메인 ──────────────────────────────────────────────
st.title("📋 취업규칙 검토 AI")
st.caption("표준취업규칙(2025년) 마스터 DB 기반 자동 검토. 결정성·재현성 우선.")

uploaded = st.file_uploader(
    "취업규칙 파일을 업로드하세요",
    type=["docx", "hwp", "hwpx", "pdf", "txt"],
    help="docx · hwp · hwpx · pdf · txt 모두 지원",
)

if uploaded is None:
    st.info("⬆️ 파일을 업로드하면 검토가 시작됩니다.")
    st.divider()
    st.markdown(
        """
        ### 검토 항목
        - **필수 46개 조**: 99개 원자 슬롯으로 자동 검사
          - 수치 검증 (≥ / ≤ / ==): 53개
          - 객체 매칭: 9개
          - LLM 해석 (interpret): 38개 — 표현 다양성 인정
        - **선택 52개 조**: 검사 없이 마스터 DB 작성시 착안사항·참고 표시
        - **위험도 분류**: 🔴 CRITICAL / 🟠 HIGH / 🟡 MEDIUM / 🔵 LOW

        ### 처리 시간
        - 보통 60~90초 (LLM 호출 ~10건 + 선택 조 인용 1건)
        """
    )
else:
    # 임시 파일로 저장 → review_file 에 path 전달
    suffix = Path(uploaded.name).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        tf.write(uploaded.getbuffer())
        tmp_path = Path(tf.name)

    st.markdown(f"#### 📄 입력 파일: `{uploaded.name}` ({uploaded.size:,} bytes)")

    # 사업장 정보 입력 — N/A 슬롯 자동 SKIP 으로 시간 절감 + 정확도
    with st.expander("🏢 사업장 정보 (체크하지 않은 항목은 보수적으로 검사)", expanded=True):
        c1, c2 = st.columns(2)
        with c1:
            shift = st.radio(
                "교대근로 도입",
                ["모름(검사)", "도입함", "미도입"],
                horizontal=True,
                help="미도입 시 22조 SKIP",
            )
            osha = st.checkbox(
                "산업안전보건법 적용 업종",
                value=True,
                help="해제 시 89·90·91·94·95조 SKIP",
            )
        with c2:
            chem = st.radio(
                "화학물질 취급",
                ["모름(검사)", "취급함", "미취급"],
                horizontal=True,
                help="미취급 시 92조 (MSDS) SKIP",
            )
            workenv = st.radio(
                "작업환경측정 대상",
                ["모름(검사)", "대상", "비대상"],
                horizontal=True,
                help="비대상 시 93조 SKIP",
            )

    def _radio_to_bool(val: str) -> bool | None:
        if val == "모름(검사)":
            return None
        return val in ("도입함", "취급함", "대상")

    context = WorkplaceContext(
        shift_work_used=_radio_to_bool(shift),
        osha_applicable=osha,
        chemical_handling=_radio_to_bool(chem),
        workenv_measurement=_radio_to_bool(workenv),
    )

    if st.button("🔍 검토 시작", type="primary", use_container_width=True):
        progress = st.empty()
        status = st.empty()
        t_start = time.time()
        try:
            with progress.container():
                with st.spinner("LLM 슬롯 추출 + 코드 룰 평가 중... (30~60초 소요)"):
                    report = review_file(
                        tmp_path,
                        catalog_path,
                        context=context,
                    )
                # 슬롯 → topic_meta 매핑을 세션에 저장 (UI 렌더 시 조회)
                from cgr.catalog import load_catalog_with_master_db
                _cat = load_catalog_with_master_db(catalog_path)
                st.session_state["_slot_topic_meta"] = {
                    s.slot_id: s.topic_meta for s in _cat.slots if s.topic_meta
                }
            elapsed = time.time() - t_start
            progress.empty()

            # ─── 종합 판정 카드 ─────────────────────────────────
            label = report.overall_label
            label_color = {"적정": "🟢", "부적정": "🔴", "검토불가": "🟡"}.get(label, "⚪")
            st.markdown(f"## {label_color} 종합 판정: **{label}**")

            # 5개 버킷 카운트
            miss_n = report.summary.get("누락", 0)
            viol_n = report.summary.get("위반", 0)
            warn_n = report.summary.get("주의", 0)
            amb_n = report.summary.get("검토필요", 0)
            ok_n = report.summary.get("적정", 0)

            _HELP_MISS = (
                "**🔴 누락** — 본문에 규정 자체가 없음\n\n"
                "- 강행규정인데 본문에서 관련 규정을 찾지 못함\n"
                "- **시정 필수** · 과태료·벌금 가능\n"
                "- 예: 임금명세서 교부의무 미기재, 교대근로 운영형태 미기재"
            )
            _HELP_VIOL = (
                "**🟠 위반** — 본문에 있으나 법정 기준 미달/구법 잔존\n\n"
                "- 강행규정인데 수치가 모자라거나 옛 법령 표현이 남아 있음\n"
                "- **시정 필수** · 과태료·벌금·징역 가능\n"
                "- 예: 배우자 출산휴가 10일(법정 20일), 연소자 1주 6시간(법정 5시간)"
            )
            _HELP_WARN = (
                "**🟡 주의** — 임의·권고 수준의 미준수\n\n"
                "- 직접 적용 벌칙이 없는 임의 사항·확인적 규정\n"
                "- **시정 권장** · 강제성 없음\n"
                "- 예: 회계연도 기준 연차 부여, 휴일 전일 임금지급 등"
            )
            _HELP_AMB = (
                "**🟣 검토필요** — 매칭이 모호함\n\n"
                "- 본문 표현이 기준과 비슷하나 명확히 일치하지 않음\n"
                "- **감독관이 본문을 직접 확인 권장**\n"
                "- 코사인 유사도 0.48~0.50 범위"
            )
            _HELP_OK = (
                "**✅ 적정** — 본문 매칭·기준 충족\n\n"
                "- 본문에 관련 규정이 명시되어 있고 법정 기준 충족\n"
                "- 또는 임의 규정 미기재 (해당사항 없음)\n"
                "- 추가 시정 불필요"
            )

            cols = st.columns(5)
            cols[0].metric("🔴 누락", miss_n, help=_HELP_MISS)
            cols[1].metric("🟠 위반", viol_n, help=_HELP_VIOL)
            cols[2].metric("🟡 주의", warn_n, help=_HELP_WARN)
            cols[3].metric("🟣 검토필요", amb_n, help=_HELP_AMB)
            cols[4].metric("✅ 적정", ok_n, help=_HELP_OK)

            st.caption(f"⏱ 처리 시간: {elapsed:.1f}s · {len(report.article_results)}개 필수 조 검사 / {len(report.optional_displays)}개 선택 조 디스플레이")

            # ─── 분류 기준 설명 (호버시 확인용) ─────────────────
            with st.expander("ℹ️ 분류 기준 — 위반·누락·주의의 차이"):
                st.markdown(
                    """
| 버킷 | 의미 | 강제성 |
|---|---|---|
| 🔴 **누락** | **본문에 규정 자체가 없음** — 강행규정 (필수기재 누락) | 시정 필수 · 과태료·벌금 가능 |
| 🟠 **위반** | 본문에 있으나 **법정 기준 미달/구법 잔존** — 강행규정 | 시정 필수 · 과태료·벌금·징역 가능 |
| 🟡 **주의** | 임의·확인적 규정의 미준수 (직접 적용 벌칙 없음) | 시정 권장 · 강제성 없음 |
| 🟣 **검토필요** | 매칭이 모호 — 감독관 재확인 권장 | — |
| ✅ **적정** | 본문에 규정이 있고 법정 기준 충족 | — |

**핵심 구분**:
- **위반 vs 주의** → 강행규정 여부 (위반은 강행, 주의는 임의)
- **누락 vs 위반** → 본문에 있느냐 없느냐 (누락은 본문에 없음, 위반은 본문에 있는데 잘못됨)
                    """
                )

            # ─── 새 5-버킷 분류 + 부가 탭 ──────────────────────
            md = render_markdown(report)
            all_findings = []
            for ar in report.article_results:
                for f in ar.findings:
                    all_findings.append((ar, f))

            n_optional = len(report.optional_displays)
            tabs = st.tabs([
                f"🔴 누락 ({miss_n})",
                f"🟠 위반 ({viol_n})",
                f"🟡 주의 ({warn_n})",
                f"🟣 검토필요 ({amb_n})",
                f"✅ 적정 ({ok_n})",
                "📊 조별 요약",
                f"📋 선택 조항 ({n_optional})",
                "📝 전체 리포트",
                "📥 다운로드",
            ])

            from cgr.verdict import classify

            def _render_filtered(bucket_name: str):
                """버킷명으로 필터링해서 렌더 (누락/위반/주의/검토필요/적정)."""
                items = [(ar, f) for ar, f in all_findings if classify(f) == bucket_name]
                if not items:
                    st.info("해당 항목 없음.")
                    return
                # 조 단위로 그룹화
                by_art: dict[int, list] = {}
                for ar, f in items:
                    by_art.setdefault(ar.article, []).append((ar, f))
                for art_no in sorted(by_art):
                    ar_first = by_art[art_no][0][0]
                    st.markdown(f"### 제{art_no}조 — {ar_first.title}")
                    for _, f in by_art[art_no]:
                        # 적정 탭은 카드 접힌 상태로 (가독성)
                        expanded_default = bucket_name != "적정"
                        with st.expander(f"`{f.slot_id}` · {bucket_name}", expanded=expanded_default):
                            # 1) 사유 — 적정 탭은 단순 메시지로 (LLM 부정 표현 노출 회피)
                            st.markdown("**📝 사유**")
                            if bucket_name == "적정":
                                if f.extracted.quote:
                                    st.markdown("본문에 관련 규정이 명시되어 있습니다.")
                                else:
                                    st.markdown("임의 규정 — 본문 미기재 가능 (해당사항 없음).")
                            else:
                                reason = f.user_reason or f.reason
                                st.markdown(reason)
                            st.markdown("")
                            # 2) 인용 (누락 표시는 '누락' 탭에서만)
                            if f.extracted.quote:
                                st.markdown("**📌 인용 (사업장 본문)**")
                                st.markdown(f"> {f.extracted.quote[:500]}")
                                st.markdown("")
                            elif bucket_name == "누락":
                                st.markdown("**📌 인용 (사업장 본문)**")
                                st.markdown("> 🟥 **본문에서 관련 규정을 찾지 못하였습니다**")
                                st.markdown("")
                            elif bucket_name == "적정":
                                # 임의 규정 미기재 등으로 인용이 비어있는 적정 — 별도 표기 없음
                                pass
                            else:
                                st.markdown("**📌 인용 (사업장 본문)**")
                                st.markdown("> _본문 인용 없음_")
                                st.markdown("")
                            # 3) 근거 법령 및 벌칙
                            if f.penalty:
                                st.markdown("**⚖️ 근거 법령 및 벌칙**")
                                for p in f.penalty:
                                    st.markdown(f"- {p}")
                                st.markdown("")
                            # 3.5) 시정 예시
                            if f.fix_example:
                                st.markdown("**✏️ 시정 예시**")
                                st.markdown(f"> {f.fix_example}")
                                st.markdown("")
                            # 4) 메타데이터 토픽 — popover 로 (expander 중첩 불가)
                            tm_list = st.session_state.get("_slot_topic_meta", {}).get(f.slot_id, [])
                            if tm_list:
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
                            # 5) 디버그 정보 (작게)
                            from cgr.reporter import _format_expected, _format_value
                            ext = _format_value(f.extracted.extracted_value)
                            exp = _format_expected(f.expected)
                            tech = ""
                            if f.user_reason and f.reason and f.user_reason != f.reason:
                                tech = f" · 기술적 사유: `{f.reason}`"
                            st.caption(f"🔧 추출값 {ext} · 기준값 {exp}{tech}")

            with tabs[0]:
                _render_filtered("누락")
            with tabs[1]:
                _render_filtered("위반")
            with tabs[2]:
                _render_filtered("주의")
            with tabs[3]:
                _render_filtered("검토필요")
            with tabs[4]:
                _render_filtered("적정")

            with tabs[5]:
                summary_rows = []
                for ar in report.article_results:
                    miss = sum(1 for f in ar.findings if classify(f) == "누락")
                    viol = sum(1 for f in ar.findings if classify(f) == "위반")
                    warn = sum(1 for f in ar.findings if classify(f) == "주의")
                    amb = sum(1 for f in ar.findings if classify(f) == "검토필요")
                    ok = sum(1 for f in ar.findings if classify(f) == "적정")
                    er = sum(1 for f in ar.findings if f.status == "ERROR")
                    summary_rows.append({
                        "조": f"제{ar.article}조",
                        "제목": ar.title,
                        "범위": ar.scope or "-",
                        "슬롯 수": len(ar.findings),
                        "🔴 누락": miss,
                        "🟠 위반": viol,
                        "🟡 주의": warn,
                        "🟣 검토필요": amb,
                        "✅ 적정": ok,
                        "⚠️ 오류": er,
                    })
                st.dataframe(summary_rows, use_container_width=True, hide_index=True)

            with tabs[6]:
                if not report.optional_displays:
                    st.info("선택 조항 디스플레이 데이터가 없습니다.")
                else:
                    st.caption(
                        "**선택 조항은 검토 AI가 적정/부적정을 판정하지 않습니다.** "
                        "마스터 DB의 작성시 착안사항·참고와 사업장 본문 인용을 함께 제공하니, "
                        "감독관 판단의 보조 자료로 활용해 주세요."
                    )
                    # 사업장에 있는 것 / 없는 것 분리
                    present = [od for od in report.optional_displays if od.user_present]
                    absent = [od for od in report.optional_displays if not od.user_present]
                    sub = st.tabs([
                        f"📄 사업장에 규정 있음 ({len(present)})",
                        f"🔍 사업장에 규정 없음 ({len(absent)})",
                    ])
                    def _render_od_list(items):
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
                            _render_od_list(present)
                    with sub[1]:
                        if not absent:
                            st.info("해당 항목 없음.")
                        else:
                            _render_od_list(absent)

            with tabs[7]:
                st.markdown(md, unsafe_allow_html=False)

            with tabs[8]:
                ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                base_name = Path(uploaded.name).stem
                st.download_button(
                    "📄 마크다운 다운로드",
                    data=md.encode("utf-8"),
                    file_name=f"report_{base_name}_{ts}.md",
                    mime="text/markdown",
                )
                st.download_button(
                    "📦 JSON 다운로드",
                    data=report.model_dump_json(indent=2).encode("utf-8"),
                    file_name=f"report_{base_name}_{ts}.json",
                    mime="application/json",
                )

        except Exception as e:
            progress.empty()
            st.error(f"검토 실패: {type(e).__name__}: {e}")
            st.exception(e)
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass
