"""시스템 설정 페이지 — 임계값·모델·DB 버전·기본 사업장 정보.

저장 시 data/admin_settings.json 갱신 + 관련 모듈 캐시 무효화.

설정 범위:
  - 임베딩 임계값 (OK / VIOLATION / 사전필터)
  - LLM 모델 / 임베딩 모델
  - 마스터 DB 버전 (2025 / 2026)
  - 검토 앱 사업장 정보 기본값
"""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[4]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import streamlit as st

from cgr.web.admin.auth import require_login
from cgr.web.admin.theme import inject_civic_theme
from cgr.store import settings_store
from cgr.web.admin.ui_common import page_header

st.set_page_config(page_title="시스템 설정", page_icon="⚙️", layout="wide")
inject_civic_theme()
require_login()
page_header(
    "시스템 설정",
    icon="⚙️",
    description="임베딩 임계값 · 모델 · 마스터 DB 버전 · 기본 사업장 정보. 변경 즉시 반영.",
)


cur = settings_store.load()


# ─── 임베딩 임계값 ──────────────────────────
st.markdown("### 1️⃣ 임베딩 임계값")
st.caption(
    "**OK ≥ ok_threshold** : 본문에 관련 표현이 명시된 것으로 인정 (적정)\n\n"
    "**VIOLATION < violation_threshold** : 본문에 부재 (누락 또는 위반)\n\n"
    "**그 사이** : 검토필요(AMBIGUOUS) — 모호 영역. 좁을수록 모호 카운트 ↓"
)

tc1, tc2 = st.columns(2)
new_ok = tc1.slider(
    "OK threshold (이상이면 적정)",
    min_value=0.30,
    max_value=0.85,
    value=float(cur.get("embed_threshold_ok", 0.50)),
    step=0.01,
    help="이 값 이상이면 본문에 명시된 것으로 인정",
)
new_vio = tc2.slider(
    "VIOLATION threshold (미만이면 누락/위반)",
    min_value=0.20,
    max_value=0.80,
    value=float(cur.get("embed_threshold_violation", 0.48)),
    step=0.01,
    help="이 값 미만이면 본문에 부재로 판정",
)
new_pre = st.slider(
    "사전 임베딩 필터 threshold (이 값 미만 조 SKIP)",
    min_value=0.10,
    max_value=0.60,
    value=float(cur.get("prefilter_threshold", 0.30)),
    step=0.01,
    help="조항 자체가 본문에 없는 영역을 SKIP — 너무 높이면 false skip 위험",
)

if new_vio > new_ok:
    st.error("⚠️ VIOLATION threshold 가 OK threshold 보다 높을 수 없습니다.")

ambiguous_range = max(0, new_ok - new_vio)
st.caption(f"📐 모호(AMBIGUOUS) 구간: **{new_vio:.2f} ~ {new_ok:.2f}** ({ambiguous_range:.2f} 폭)")

st.divider()


# ─── 모델 ────────────────────────────────
st.markdown("### 2️⃣ LLM·임베딩 모델")
st.caption(
    "변경 시 **다음 LLM 호출부터 즉시 반영** (캐시 키가 모델명을 포함하므로 자동 cache miss). "
    "최적 모델 비교는 **「⚖️ 모델 비교」 페이지** 활용 권장."
)

mc1, mc2 = st.columns(2)

# LLM 모델 후보 — 최신 ↔ 경량 단계별 비교용
LLM_OPTIONS = [
    "gpt-5.5",
    "gpt-5.5-mini",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5",
    "gpt-5-mini",
    "gpt-4o",
    "gpt-4o-mini",
]
EMB_OPTIONS = ["text-embedding-3-large", "text-embedding-3-small"]

cur_llm = cur.get("llm_model", "gpt-5.4-mini")
new_llm = mc1.selectbox(
    "LLM 모델",
    LLM_OPTIONS + ([cur_llm] if cur_llm not in LLM_OPTIONS else []),
    index=(LLM_OPTIONS + ([cur_llm] if cur_llm not in LLM_OPTIONS else [])).index(cur_llm),
    help=(
        "추출·풀이 LLM. 변경 시 캐시 자동 무효화.\n\n"
        "권장 단계별 비교:\n"
        "- gpt-5.4-mini (현재 기본) — 속도·비용 균형\n"
        "- gpt-5.4 — 정확도 향상\n"
        "- gpt-5.5 / gpt-5.5-mini — 최신 모델 (가용 시)\n"
        "- gpt-4o / gpt-4o-mini — 안정 백업"
    ),
)

cur_emb = cur.get("embed_model", "text-embedding-3-large")
new_emb = mc2.selectbox(
    "임베딩 모델",
    EMB_OPTIONS,
    index=EMB_OPTIONS.index(cur_emb) if cur_emb in EMB_OPTIONS else 0,
    help="text-embedding-3-large 권장 (1024d truncate)",
)

# 모델 변경 시 옛 캐시 정리 권장 안내
if new_llm != cur_llm:
    st.info(
        f"🔄 **LLM 모델 변경 감지**: `{cur_llm}` → `{new_llm}`\n\n"
        "- 새 모델로 재호출되므로 결과 약간 변동 가능 (정확도·시간·비용)\n"
        "- 이전 모델의 LLM 캐시는 자동 무효화되지만 디스크에는 남아 있음 — 정리하려면 「💾 캐시 관리」에서 일괄 삭제\n"
        "- 두 모델 결과를 비교하려면 「⚖️ 모델 비교」 페이지 사용"
    )

st.divider()


# ─── 마스터 DB 버전 ─────────────────────────
st.markdown("### 3️⃣ 마스터 DB 버전")
cur_ver = cur.get("master_db_version", "2026")
new_ver = st.radio(
    "활성 마스터 DB 버전",
    ["2025", "2026"],
    index=["2025", "2026"].index(cur_ver) if cur_ver in ("2025", "2026") else 1,
    horizontal=True,
    help="2026 권장. 변경 시 다음 검토부터 반영 (마스터 DB 캐시 자동 무효화)",
)

# 현재 활성 경로 표시
try:
    from cgr.master_db import _resolve_path

    st.caption(f"📂 현재 활성 경로 (재계산): _저장 후_ 갱신됩니다.")
    st.code(str(_resolve_path()), language="text")
except Exception as e:
    st.warning(f"DB 경로 확인 실패: {e}")

st.divider()


# ─── 기본 사업장 정보 ────────────────────
st.markdown("### 4️⃣ 검토 앱 기본 사업장 정보")
st.caption("검토 앱(8501) 의 사업장 정보 입력 폼 초기값. 사용자가 매번 다시 선택할 필요 줄임.")

wp = cur.get("default_workplace") or {}
wc1, wc2 = st.columns(2)


def _bool_to_radio(v):
    if v is None:
        return "모름(검사)"
    return "도입함" if v else "미도입"


def _radio_to_bool(s):
    if s == "모름(검사)":
        return None
    return s in ("도입함", "취급함", "대상")


with wc1:
    new_shift = st.radio(
        "교대근로 도입 (기본값)",
        ["모름(검사)", "도입함", "미도입"],
        index=["모름(검사)", "도입함", "미도입"].index(_bool_to_radio(wp.get("shift_work_used"))),
        horizontal=True,
    )
    new_osha = st.checkbox(
        "산업안전보건법 적용 업종 (기본값)",
        value=bool(wp.get("osha_applicable", True)),
    )
with wc2:
    chem_now = wp.get("chemical_handling")
    chem_label = (
        "모름(검사)" if chem_now is None else ("취급함" if chem_now else "미취급")
    )
    new_chem = st.radio(
        "화학물질 취급 (기본값)",
        ["모름(검사)", "취급함", "미취급"],
        index=["모름(검사)", "취급함", "미취급"].index(chem_label),
        horizontal=True,
    )
    we_now = wp.get("workenv_measurement")
    we_label = "모름(검사)" if we_now is None else ("대상" if we_now else "비대상")
    new_we = st.radio(
        "작업환경측정 대상 (기본값)",
        ["모름(검사)", "대상", "비대상"],
        index=["모름(검사)", "대상", "비대상"].index(we_label),
        horizontal=True,
    )

st.divider()


# ─── 저장 / 초기화 ──────────────────────────
sc1, sc2 = st.columns(2)
if sc1.button("💾 변경 저장", type="primary", use_container_width=True, disabled=(new_vio > new_ok)):
    new_settings = {
        "embed_threshold_ok": float(new_ok),
        "embed_threshold_violation": float(new_vio),
        "prefilter_threshold": float(new_pre),
        "llm_model": new_llm,
        "embed_model": new_emb,
        "master_db_version": new_ver,
        "default_workplace": {
            "shift_work_used": _radio_to_bool(new_shift),
            "osha_applicable": new_osha,
            "chemical_handling": _radio_to_bool(new_chem),
            "workenv_measurement": _radio_to_bool(new_we),
        },
    }
    try:
        bdir = settings_store.save(new_settings)
        # 마스터 DB 캐시 무효화 (버전 전환 즉시 반영)
        try:
            from cgr.master_db import get_master_db
            get_master_db.cache_clear()
        except Exception:
            pass
        # 카탈로그 캐시도 무효화 (마스터 enrich 영향)
        try:
            from cgr.catalog import _load_cached
            _load_cached.cache_clear()
        except Exception:
            pass

        msg = "✅ 설정 저장 완료. 다음 검토부터 반영됩니다."
        if bdir:
            msg += f"\n\n백업: `{bdir.relative_to(_ROOT)}`"
        st.success(msg)
    except Exception as e:
        st.error(f"❌ 저장 실패: {e}")

if sc2.button("↩️ 기본값으로 초기화", use_container_width=True):
    try:
        bdir = settings_store.save(dict(settings_store.DEFAULTS))
        st.success(f"✅ 기본값으로 초기화. 백업: `{bdir.relative_to(_ROOT) if bdir else '없음'}`")
        st.rerun()
    except Exception as e:
        st.error(f"❌ 실패: {e}")

st.divider()

# ─── 현재 설정 미리보기 ─────────────────
with st.expander("📋 현재 저장된 설정 (admin_settings.json)"):
    st.json(cur, expanded=True)
    st.caption(f"📂 `{settings_store.settings_path()}`")
