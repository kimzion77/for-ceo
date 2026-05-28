"""UI 공통 자원 — 색·이모지·severity·comparator 매핑.

검토 앱(streamlit_app.py)·관리자 페이지·마크다운 리포트·API 응답에서
공유되는 시각·라벨 상수들을 한 곳에 모은다.

기존 인라인 상수가 5+ 곳에 흩어진 것을 통합. 새 컴포넌트 추가 시 여기를 참조.
"""
from cgr.ui.constants import (
    BUCKET_COLORS,
    BUCKET_EMOJI,
    BUCKET_HELP,
    BUCKET_ORDER,
    COMPARATOR_LABEL,
    OVERALL_EMOJI,
    SEVERITY_COLOR,
    SEVERITY_ORDER,
)

__all__ = [
    "BUCKET_COLORS",
    "BUCKET_EMOJI",
    "BUCKET_HELP",
    "BUCKET_ORDER",
    "COMPARATOR_LABEL",
    "OVERALL_EMOJI",
    "SEVERITY_COLOR",
    "SEVERITY_ORDER",
]
