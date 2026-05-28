"""관리자 대시보드 인증.

비밀번호 검증·세션 가드·로그인 잠금.

비밀번호 우선순위:
  1. .streamlit/secrets.toml 의 admin_password
  2. 환경변수 ADMIN_PASSWORD
  3. 둘 다 없으면 명시적 오류 (보안 사고 방지)

세션 키:
  - admin_authed       : 인증 완료 여부 (bool)
  - admin_login_fails  : 누적 실패 횟수
  - admin_lockout_until: 잠금 해제 시각 (epoch seconds)
"""
from __future__ import annotations

import os
import time

import streamlit as st


_LOCKOUT_THRESHOLD = 5         # 실패 5회 시 잠금
_LOCKOUT_SECONDS = 5 * 60      # 5분 잠금


def _resolve_password() -> str | None:
    """관리자 비밀번호를 secrets → env 순으로 조회. 없으면 None."""
    try:
        # st.secrets 는 secrets.toml 미존재 시 예외
        secret_pw = st.secrets.get("admin_password")
        if secret_pw:
            return str(secret_pw)
    except Exception:
        pass
    env_pw = os.environ.get("ADMIN_PASSWORD")
    if env_pw:
        return env_pw
    return None


def _is_locked() -> tuple[bool, int]:
    """현재 잠금 상태인지 + 남은 초."""
    until = st.session_state.get("admin_lockout_until", 0)
    now = time.time()
    if until > now:
        return True, int(until - now)
    return False, 0


def _login_form(expected: str) -> None:
    """로그인 폼 렌더링. 인증 성공 시 session_state 갱신."""
    st.markdown("# 🛠 취업규칙 관리자 대시보드")
    st.caption("시스템 관리자 전용. 비밀번호 인증이 필요합니다.")

    locked, remain = _is_locked()
    if locked:
        st.error(f"🔒 5회 연속 실패로 잠금 상태입니다. 약 {remain // 60}분 {remain % 60}초 후 다시 시도해 주세요.")
        st.stop()

    with st.form("admin_login_form", clear_on_submit=False):
        pw = st.text_input("관리자 비밀번호", type="password", placeholder="••••••••")
        submitted = st.form_submit_button("🔓 로그인", type="primary", use_container_width=True)

    if submitted:
        if pw == expected:
            st.session_state["admin_authed"] = True
            st.session_state["admin_login_fails"] = 0
            st.success("✅ 인증 성공")
            time.sleep(0.4)
            st.rerun()
        else:
            fails = st.session_state.get("admin_login_fails", 0) + 1
            st.session_state["admin_login_fails"] = fails
            if fails >= _LOCKOUT_THRESHOLD:
                st.session_state["admin_lockout_until"] = time.time() + _LOCKOUT_SECONDS
                st.error(f"🔒 5회 연속 실패 — {_LOCKOUT_SECONDS // 60}분간 잠금됩니다.")
                st.stop()
            st.error(f"❌ 비밀번호가 일치하지 않습니다 ({fails}/{_LOCKOUT_THRESHOLD})")


def require_login() -> None:
    """모든 관리자 페이지 진입 시 호출. 미인증 → 로그인 폼 + st.stop()."""
    expected = _resolve_password()
    if not expected:
        st.error(
            "⚠️ 관리자 비밀번호가 설정되지 않았습니다.\n\n"
            "다음 중 하나로 설정해 주세요:\n"
            "- `.streamlit/secrets.toml` 에 `admin_password = \"...\"`\n"
            "- 환경변수 `ADMIN_PASSWORD`"
        )
        st.stop()

    if st.session_state.get("admin_authed"):
        # 이미 인증됨 — 사이드바에 로그아웃 버튼만 표시
        with st.sidebar:
            st.markdown("---")
            if st.button("🚪 로그아웃", use_container_width=True):
                logout()
                st.rerun()
        return

    _login_form(expected)
    st.stop()


def logout() -> None:
    """세션 인증 정보 제거."""
    for k in ("admin_authed", "admin_login_fails", "admin_lockout_until"):
        st.session_state.pop(k, None)
