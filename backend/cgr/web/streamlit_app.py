"""취업규칙 검토 AI — Streamlit 웹 UI (감독관용).

실행:
    cd <mvp dir>
    streamlit run cgr/web/streamlit_app.py
    # 또는: python launch_streamlit.py

세부 컴포넌트는 `cgr/web/review_app/` 패키지에 분리:
  - sidebar         : 환경·DB·캐시·토픽·카탈로그
  - workplace_form  : 사업장 정보 입력 폼
  - result_tabs     : 9-탭 결과 화면
  - help_text       : 호버 도움말 모음
"""
from __future__ import annotations

import sys
import tempfile
import time
from pathlib import Path

# cgr 패키지 import 보장
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import streamlit as st

from cgr.reporter import render_markdown
from cgr.run import review_file
from cgr.web.review_app.help_text import INTRO_MARKDOWN
from cgr.web.review_app.result_tabs import render_result_view
from cgr.web.review_app.sidebar import render_sidebar
from cgr.web.review_app.workplace_form import render_workplace_form


st.set_page_config(
    page_title="취업규칙 검토 AI",
    page_icon="📋",
    layout="wide",
    initial_sidebar_state="expanded",
)


# 방문 로그 (세션당 1회) — 관리자 통계용
if "_visit_logged" not in st.session_state:
    try:
        from cgr.web.admin.store.access_log import log_event
        log_event(service="취업규칙", action="visit")
    except Exception:
        pass
    st.session_state["_visit_logged"] = True


# ─── 카탈로그 경로 ───
CATALOG_PATH = _ROOT / "data" / "slots" / "atomic_slots_v0.yaml"


# ─── 사이드바 ─────────────────────────
render_sidebar(CATALOG_PATH)


# ─── 메인 화면 ────────────────────────
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
    st.markdown(INTRO_MARKDOWN)
else:
    # 임시 파일로 저장
    suffix = Path(uploaded.name).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
        tf.write(uploaded.getbuffer())
        tmp_path = Path(tf.name)

    st.markdown(f"#### 📄 입력 파일: `{uploaded.name}` ({uploaded.size:,} bytes)")

    # 사업장 정보 입력
    context = render_workplace_form()

    if st.button("🔍 검토 시작", type="primary", use_container_width=True):
        progress = st.empty()
        t_start = time.time()
        try:
            with progress.container():
                with st.spinner("LLM 슬롯 추출 + 코드 룰 평가 중... (30~60초 소요)"):
                    report = review_file(tmp_path, CATALOG_PATH, context=context)

                # 슬롯 → topic_meta 매핑을 세션에 저장 (result_tabs 에서 사용)
                from cgr.catalog import load_catalog_with_master_db

                _cat = load_catalog_with_master_db(CATALOG_PATH)
                st.session_state["_slot_topic_meta"] = {
                    s.slot_id: s.topic_meta for s in _cat.slots if s.topic_meta
                }

                # 관리자 이력 누적 + access_log (실패해도 검토 통과)
                _accumulate_history_and_log(report, uploaded.name)

            elapsed = time.time() - t_start
            progress.empty()

            md = render_markdown(report)
            render_result_view(report, md, uploaded.name, elapsed)

        except Exception as e:
            progress.empty()
            st.error(f"검토 실패: {type(e).__name__}: {e}")
            st.exception(e)
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass


def _accumulate_history_and_log(report, filename: str) -> None:
    """검토 완료 시 관리자 이력 + access_log 누적 (실패해도 silent)."""
    try:
        from cgr.web.admin.store.history import (
            append_history,
            build_entry_from_report,
        )

        entry = build_entry_from_report(report)
        entry["filename"] = filename
        entry["service"] = "취업규칙"
        append_history(entry)
    except Exception:
        return  # access_log 도 건너뜀

    try:
        from cgr.web.admin.store.access_log import log_event

        log_event(
            service="취업규칙",
            action="review",
            meta={"filename": filename, "n_findings": entry.get("n_findings", 0)},
        )
    except Exception:
        pass
