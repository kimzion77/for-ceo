"""시스템 프롬프트 편집 페이지 — extractor / explainer.

저장 위치: data/prompts/{extractor,explainer}.md
편집 → 저장 시 자동 백업 → 다음 LLM 호출에서 즉시 반영 (cache key 자동 변경).
모듈 기본값으로 비교·롤백 가능.
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
from cgr.store import prompt_writer
from cgr.web.admin.ui_common import page_header, render_diff


st.set_page_config(page_title="프롬프트 편집", page_icon="📝", layout="wide")
inject_civic_theme()
require_login()
page_header(
    "시스템 프롬프트 편집",
    icon="📝",
    description="LLM 추출(extractor) · 사유 풀이(explainer) 시스템 프롬프트 직접 편집. "
    "저장 시 다음 LLM 호출부터 자동 반영 (캐시 자동 무효화).",
)

# ─── 전체 프롬프트 지도 (LLM이 보는 모든 텍스트의 위치) ───
with st.expander("🗺 검토 AI 의 모든 프롬프트 구성요소 (8가지) — 어디서 편집?", expanded=False):
    st.markdown(
        """
        LLM 한 번 호출 시 들어가는 텍스트는 **시스템 프롬프트 + User 프롬프트 + Function 스키마** 세 부분입니다.
        그 중 **편집 가능한 위치**가 어디인지 정리합니다.

        | # | 구성요소 | 어디서 편집? | 영향 범위 |
        |---|---|---|---|
        | 1 | **Extractor 시스템 프롬프트** | 이 페이지 ↓ (`data/prompts/extractor.md`) | 모든 추출 호출 |
        | 2 | **Explainer 시스템 프롬프트** | 이 페이지 ↓ (`data/prompts/explainer.md`) | 모든 사유풀이 호출 |
        | 3 | **Extractor User 프롬프트** (본문+슬롯스펙 결합 템플릿) | 코드: `cgr/extractor.py::extract_slots()` | 모든 추출 호출 |
        | 4 | **Explainer User 프롬프트** (finding+법령 JSON 결합) | 코드: `cgr/explainer.py::_format_finding_input()` | 모든 사유풀이 호출 |
        | 5 | **Function 호출 스키마** (구조화 출력 강제) | 코드: `cgr/extractor.py::_build_tool_schema()` | 모든 추출 호출 |
        | 6 | **슬롯별 `extract_target`** (LLM 추출 지시문 1줄~N줄) | 「📋 슬롯편집」 페이지 | 해당 슬롯만 |
        | 7 | **슬롯별 `interpret_criteria`** (LLM 판정 룰 — interpret 슬롯 10개) | 「📋 슬롯편집」 페이지 | 해당 슬롯만 |
        | 8 | **슬롯별 `search_phrases`** (embed_match 코사인 매칭 — 44개) | 「📋 슬롯편집」 페이지 | LLM 미사용 |

        ### 영향 범위 정리
        - **1·2** (시스템 프롬프트) — **이 페이지에서 바로 편집** 가능. 전체 LLM 호출에 영향.
        - **3·4·5** (User 프롬프트 빌더·스키마) — 코드 파일 직접 수정. Streamlit 자동 reload 됨.
        - **6·7·8** (슬롯별 텍스트) — 「📋 슬롯편집」 페이지에서 슬롯 단위로 편집.

        ### LLM 호출 한 번에 합쳐지는 흐름
        ```
        ┌─ Extractor 호출 ─────────────────────────────┐
        │  system : (1) Extractor 시스템 프롬프트         │
        │  user   : (3) 본문 + 슬롯 N개의 (6) extract_target  │
        │  tools  : (5) Function 스키마                  │
        └──────────────────────────────────────────────┘

        ┌─ Explainer 호출 ─────────────────────────────┐
        │  system : (2) Explainer 시스템 프롬프트         │
        │  user   : (4) 위반·누락 finding + 슬롯 (6,7)+벌칙  │
        │  tools  : submit_rewrites 스키마               │
        └──────────────────────────────────────────────┘
        ```
        """
    )


# ─── 상단 KPI ────────────────────────────
stats = prompt_writer.stats()

cols = st.columns(2)
for i, (name, label, icon) in enumerate([("extractor", "Extractor", "🔍"), ("explainer", "Explainer", "💬")]):
    s = stats[name]
    with cols[i]:
        diverged = "🔀 사용자화" if s["diverged"] else ("✅ 기본값" if not s["exists"] else "📄 외부 파일")
        st.metric(
            f"{icon} {label}",
            f"{s['chars']:,} chars",
            help=f"{s['lines']} 줄 · 상태: {diverged}",
        )
        if s["mtime"]:
            st.caption(f"수정: {s['mtime']}")

st.divider()


# ─── 편집 대상 선택 ─────────────────────
target = st.radio(
    "편집할 프롬프트",
    ["extractor", "explainer"],
    horizontal=True,
    format_func=lambda x: {"extractor": "🔍 Extractor (슬롯 추출)", "explainer": "💬 Explainer (사유 풀이)"}[x],
)

current = prompt_writer.load_current(target)
default = prompt_writer.load_default(target)
is_diverged = current != default
is_external = prompt_writer.prompt_path(target).exists()

c1, c2, c3 = st.columns(3)
c1.metric("현재 길이", f"{len(current):,} chars")
c2.metric("기본값 길이", f"{len(default):,} chars")
c3.metric(
    "차이",
    f"{'다름' if is_diverged else '같음'}",
    help=f"외부 파일 존재: {is_external}",
)

st.divider()


# ─── 편집 폼 ───────────────────────────
st.markdown(f"### ✏️ 편집: `{target}`")
st.caption(
    "줄바꿈 그대로 보존됩니다. Markdown 으로 작성 권장 — LLM 이 구조를 잘 이해합니다."
)

new_content = st.text_area(
    "프롬프트 본문",
    value=current,
    height=560,
    label_visibility="collapsed",
    key=f"prompt_edit_{target}",
)

# 변경 통계
diff_chars = len(new_content) - len(current)
ec1, ec2, ec3 = st.columns([1, 1, 2])
ec1.metric("새 길이", f"{len(new_content):,}", delta=f"{diff_chars:+d}")
ec2.metric("줄 수", f"{new_content.count(chr(10)) + 1:,}")
ec3.caption("아래 '저장' 버튼을 누르면 자동 백업되고 다음 검토부터 반영됩니다.")

# diff 미리보기
with st.expander("🔍 변경 diff 미리보기 (저장 전 확인)"):
    render_diff(current, new_content, label_before="현재", label_after="수정 후")


# ─── 저장 / 롤백 ──────────────────────
sc1, sc2, sc3 = st.columns(3)

if sc1.button("💾 변경 저장", type="primary", use_container_width=True, disabled=(new_content == current)):
    try:
        bdir = prompt_writer.save(target, new_content, backup=True)
        msg = f"✅ `{target}` 프롬프트 저장 완료. 다음 검토부터 반영됩니다."
        if bdir:
            msg += f"\n\n백업: `{bdir.relative_to(_ROOT)}`"
        st.success(msg)
        # LLM 캐시도 함께 비울지 안내
        st.info(
            "💡 SHA256 키가 자동으로 변경되어 다음 LLM 호출에서 cache miss → 재호출됩니다. "
            "이미 저장된 옛 캐시 항목을 정리하려면 「💾 캐시 관리」 페이지에서 해당 type 일괄 삭제 권장."
        )
    except Exception as e:
        st.error(f"❌ 저장 실패: {e}")

if sc2.button("↩️ 모듈 기본값으로 복귀", use_container_width=True, disabled=not is_external):
    try:
        bdir = prompt_writer.reset_to_default(target)
        st.success(
            f"✅ `{target}` 외부 파일 제거 — 모듈 내장 기본값으로 복귀.\n\n"
            f"백업: `{bdir.relative_to(_ROOT) if bdir else '없음'}`"
        )
        st.rerun()
    except Exception as e:
        st.error(f"❌ 실패: {e}")

if sc3.button("👁 기본값과 비교", use_container_width=True):
    st.session_state[f"_show_default_compare_{target}"] = True

if st.session_state.get(f"_show_default_compare_{target}"):
    with st.expander("📋 모듈 기본값 vs 현재 외부 파일", expanded=True):
        cmp_c1, cmp_c2 = st.columns(2)
        cmp_c1.markdown("**모듈 기본값**")
        cmp_c1.code(default[:3000] + ("\n\n... (생략)" if len(default) > 3000 else ""), language="markdown")
        cmp_c2.markdown("**현재 사용 중**")
        cmp_c2.code(current[:3000] + ("\n\n... (생략)" if len(current) > 3000 else ""), language="markdown")

st.divider()


# ─── User Prompt 빌더 미리보기 (read-only) ───
with st.expander("🔍 User 프롬프트 빌더 코드 미리보기 (read-only)"):
    st.caption(
        "Streamlit UI 에서 직접 편집은 어렵습니다. 이 페이지는 빌더 코드 위치 안내. "
        "수정하려면 코드 파일 (`cgr/extractor.py`, `cgr/explainer.py`) 직접 편집 → Streamlit 자동 reload."
    )
    import inspect

    builder_target = st.radio(
        "확인할 빌더",
        [
            "Extractor — 슬롯 spec 포매터 (_format_slot_spec)",
            "Explainer — finding 입력 포매터 (_format_finding_input)",
        ],
        horizontal=True,
    )
    try:
        if "Extractor" in builder_target:
            from cgr.extractor import _format_slot_spec
            src = inspect.getsource(_format_slot_spec)
            st.caption(
                "💡 `extract_slots()` 안에서 본문 + 위 함수 출력(슬롯별)을 결합해 user prompt 를 만듭니다. "
                "본문 그대로 + 슬롯 spec 만 가변 (OpenAI prompt cache 최적화)."
            )
        else:
            from cgr.explainer import _format_finding_input
            src = inspect.getsource(_format_finding_input)
            st.caption(
                "💡 위반·누락 finding 1건을 한국어 JSON 으로 변환. LLM 이 평이한 사유로 풀이."
            )
        st.code(src, language="python")
    except Exception as e:
        st.warning(f"빌더 함수를 찾지 못했습니다: {e}")


# ─── Function 스키마 미리보기 ───
with st.expander("🧩 Function 호출 스키마 미리보기 (구조화 출력 강제)"):
    st.caption(
        "LLM 응답이 항상 같은 JSON 구조로 오도록 강제합니다. 슬롯 수에 따라 동적으로 생성됨."
    )
    try:
        import json as _json
        from cgr.catalog import load_catalog_with_master_db
        from cgr.extractor import _build_tool_schema

        catalog = load_catalog_with_master_db(_ROOT / "data" / "slots" / "atomic_slots_v0.yaml")
        # 대표 슬롯 3개만으로 스키마 생성 (미리보기용)
        sample_slots = catalog.slots[:3]
        schema = _build_tool_schema(sample_slots)
        st.code(_json.dumps(schema, ensure_ascii=False, indent=2), language="json")
    except Exception as e:
        st.warning(f"스키마 미리보기 실패: {e}")


st.divider()


# ─── 안내 ──────────────────────────────
with st.expander("ℹ️ 프롬프트 편집 가이드"):
    st.markdown(
        """
        ### 영향 범위
        - **Extractor**: 사업장 본문 → 슬롯 추출 (수치·boolean·객체). 본문 부재 처리, 구법/신법 추출 규칙 등.
        - **Explainer**: 위반·누락 사유를 평이한 한국어로 풀이. 비교 방향·법령 인용·표기 규칙.

        ### 작성 팁
        - 줄바꿈 그대로 보존됩니다 (`\\n` 그대로 사용 가능)
        - **마크다운 헤더** (`[역할]`, `[추출 규칙]`)로 구조화하면 LLM 이 더 잘 이해
        - **이모지** (⚠️ 📌 🔎)는 강조 효과 있음
        - 명령조 ("절대 금지", "반드시") 가 효과적
        - 예시 (Good vs Bad) 포함 권장

        ### 결정성
        - 같은 프롬프트 + 같은 입력 → 같은 출력 (캐시 hit)
        - 프롬프트 변경 시 SHA256 키 자동 변경 → cache miss → LLM 재호출 → 새 응답 캐싱
        - 변경 직후 검토 1회는 LLM 호출 발생 (약 15~30초), 그 다음부터는 캐시 hit

        ### 백업·롤백
        - 저장 시마다 `backups/<ts>_prompt_<name>/` 에 자동 보존
        - "모듈 기본값으로 복귀" 클릭 → 외부 파일 제거 (백업 후), 모듈 내장 기본값으로 동작
        - 코드 모듈의 `_SYSTEM_PROMPT` 상수는 절대 변경되지 않음 (안전망)
        """
    )
