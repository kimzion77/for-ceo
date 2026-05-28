"""관리자 대시보드 공통 UI 컴포넌트.

- 페이지 공통 헤더 (제목·설명·인증)
- diff 미리보기 렌더
- KPI 카드
- 경로 헬퍼
"""
from __future__ import annotations

import difflib
import sys
from pathlib import Path

import streamlit as st

# 모듈 상위 경로 등록 (streamlit pages/ 에서 cgr 패키지 import 보장)
_ROOT = Path(__file__).resolve().parents[3]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def project_root() -> Path:
    """mvp 프로젝트 루트 절대 경로."""
    return _ROOT


def data_dir() -> Path:
    """data/ 절대 경로."""
    return _ROOT / "data"


def backups_dir() -> Path:
    """backups/ 절대 경로 (자동 생성)."""
    p = _ROOT / "backups"
    p.mkdir(parents=True, exist_ok=True)
    return p


def page_header(title: str, icon: str = "🛠", description: str = "") -> None:
    """관리자 페이지 공통 헤더."""
    st.markdown(f"# {icon} {title}")
    if description:
        st.caption(description)
    st.divider()


def render_diff(before: str, after: str, label_before: str = "이전", label_after: str = "이후") -> None:
    """unified_diff 를 st.code(language='diff') 로 렌더링.

    변경이 없으면 안내 메시지만 표시.
    """
    if before == after:
        st.info("변경 사항 없음.")
        return
    diff_lines = list(
        difflib.unified_diff(
            before.splitlines(),
            after.splitlines(),
            fromfile=label_before,
            tofile=label_after,
            lineterm="",
            n=2,
        )
    )
    if not diff_lines:
        st.info("변경 사항 없음.")
        return
    st.code("\n".join(diff_lines), language="diff")


def kpi_card(col, label: str, value, help_text: str | None = None) -> None:
    """KPI 메트릭 카드 (st.metric 래퍼)."""
    col.metric(label, value, help=help_text)


def info_box(title: str, body: str, kind: str = "info") -> None:
    """알림 박스 (info/success/warning/error)."""
    fn = {"info": st.info, "success": st.success, "warning": st.warning, "error": st.error}.get(kind, st.info)
    fn(f"**{title}**\n\n{body}")
