"""사업장 정보 입력 폼.

호출: `ctx = render_workplace_form()` → WorkplaceContext 반환
"""
from __future__ import annotations

import streamlit as st

from cgr.models import WorkplaceContext
from cgr.web.review_app.help_text import HELP_CHEM, HELP_OSHA, HELP_SHIFT, HELP_WORKENV


def _radio_to_bool(val: str) -> bool | None:
    if val == "모름(검사)":
        return None
    return val in ("도입함", "취급함", "대상")


def render_workplace_form() -> WorkplaceContext:
    """사업장 정보 입력 폼 + WorkplaceContext 반환."""
    with st.expander(
        "🏢 사업장 정보 (체크하지 않은 항목은 보수적으로 검사)",
        expanded=True,
    ):
        c1, c2 = st.columns(2)
        with c1:
            shift = st.radio(
                "교대근로 도입",
                ["모름(검사)", "도입함", "미도입"],
                horizontal=True,
                help=HELP_SHIFT,
            )
            osha = st.checkbox(
                "산업안전보건법 적용 업종",
                value=True,
                help=HELP_OSHA,
            )
        with c2:
            chem = st.radio(
                "화학물질 취급",
                ["모름(검사)", "취급함", "미취급"],
                horizontal=True,
                help=HELP_CHEM,
            )
            workenv = st.radio(
                "작업환경측정 대상",
                ["모름(검사)", "대상", "비대상"],
                horizontal=True,
                help=HELP_WORKENV,
            )

    return WorkplaceContext(
        shift_work_used=_radio_to_bool(shift),
        osha_applicable=osha,
        chemical_handling=_radio_to_bool(chem),
        workenv_measurement=_radio_to_bool(workenv),
    )
