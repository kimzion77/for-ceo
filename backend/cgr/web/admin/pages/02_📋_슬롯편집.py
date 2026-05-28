"""슬롯 카탈로그 편집 페이지.

기능:
  - 좌측: 슬롯 목록 (필터: comparator·severity·조 번호·키워드)
  - 우측: 선택 슬롯 상세 + 인라인 편집 폼
  - diff 미리보기 → 확인 → 저장 (자동 백업 + 캐시 무효화)
  - 일괄 작업: severity·threshold 일괄 변경

YAML 직접 편집을 대체. 모든 변경은 backups/ 에 자동 보존.
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
from cgr.web.admin.store import slot_writer
from cgr.web.admin.ui_common import page_header, render_diff


st.set_page_config(page_title="슬롯 편집", page_icon="📋", layout="wide")
inject_civic_theme()
require_login()
page_header(
    "슬롯 카탈로그 편집",
    icon="📋",
    description="atomic_slots_v0.yaml 을 직접 편집합니다. 저장 시 자동 백업.",
)


# ─── 데이터 로드 ──────────────────────────────
@st.cache_data(ttl=10)
def _load_slots() -> tuple[list[dict], float]:
    """원본 YAML 의 slots 리스트 + mtime."""
    parsed = slot_writer.load_raw()
    mtime = slot_writer.slots_yaml_path().stat().st_mtime
    return parsed.get("slots", []), mtime


slots, mtime = _load_slots()
st.caption(f"📄 `{slot_writer.slots_yaml_path()}` · 슬롯 **{len(slots)}**개")


# ─── 필터 바 ─────────────────────────────────
with st.expander("🔍 필터", expanded=True):
    fc1, fc2, fc3, fc4 = st.columns([1.2, 1.2, 1.5, 2])

    all_comparators = sorted({s.get("comparator", "") for s in slots if s.get("comparator")})
    all_severities = sorted(
        {s.get("violation_severity") for s in slots if s.get("violation_severity")}
    )

    f_comp = fc1.multiselect("comparator", all_comparators, default=[])
    f_sev = fc2.multiselect("severity", all_severities, default=[])
    art_min = fc3.number_input("조 번호 최소", min_value=1, max_value=98, value=1)
    art_max = fc3.number_input("조 번호 최대", min_value=1, max_value=98, value=98)
    f_keyword = fc4.text_input("키워드 (slot_id / extract_target)", value="")


def _filter_slot(s: dict) -> bool:
    if f_comp and s.get("comparator") not in f_comp:
        return False
    if f_sev and s.get("violation_severity") not in f_sev:
        return False
    art = s.get("article", 0)
    if not (art_min <= art <= art_max):
        return False
    if f_keyword:
        kw = f_keyword.lower()
        haystack = " ".join(
            [
                s.get("slot_id", ""),
                str(s.get("extract_target", "")),
            ]
        ).lower()
        if kw not in haystack:
            return False
    return True


filtered = [s for s in slots if _filter_slot(s)]
st.caption(f"필터 결과: **{len(filtered)}**개 / 전체 {len(slots)}개")


# ─── 좌·우 분할 레이아웃 ─────────────────────
left, right = st.columns([1, 1.6])


# ─── 좌측: 슬롯 리스트 (selectbox + 미리보기 표) ──
with left:
    st.markdown("### 슬롯 선택")

    if not filtered:
        st.warning("조건에 맞는 슬롯이 없습니다. 필터를 조정해 주세요.")
        st.stop()

    # selectbox 라벨: 제N조 [comparator] slot_id (severity)
    def _label(s: dict) -> str:
        sev = s.get("violation_severity", "—")
        return f"제{s.get('article', '?')}조 [{s.get('comparator', '?')}] {s['slot_id']} ({sev})"

    options = [s["slot_id"] for s in filtered]
    sel_id = st.selectbox(
        "편집할 슬롯",
        options,
        format_func=lambda sid: _label(next(s for s in filtered if s["slot_id"] == sid)),
        key="sel_slot_id",
    )

    # 미리보기 표 (필터된 슬롯 요약)
    import pandas as pd

    rows = []
    for s in filtered[:200]:
        rows.append(
            {
                "조": s.get("article", "?"),
                "slot_id": s["slot_id"],
                "comparator": s.get("comparator", ""),
                "severity": s.get("violation_severity", ""),
                "required": s.get("required", False),
            }
        )
    st.dataframe(rows, use_container_width=True, height=380, hide_index=True)


# ─── 우측: 편집 폼 ──────────────────────────
with right:
    sel = next(s for s in filtered if s["slot_id"] == sel_id)

    st.markdown(f"### 📝 편집: `{sel_id}`")
    st.caption(f"제{sel.get('article')}조 · comparator=`{sel.get('comparator')}` · required={sel.get('required')}")

    with st.form(f"slot_edit_form_{sel_id}", clear_on_submit=False):
        # ── extract_target (편집 가능)
        new_extract_target = st.text_area(
            "extract_target (LLM 지시문)",
            value=sel.get("extract_target", "") or "",
            height=160,
        )

        # ── search_phrases (data_editor)
        sp_init = list(sel.get("search_phrases") or [])
        new_search_phrases = st.data_editor(
            pd.DataFrame({"search_phrase": sp_init or [""]}),
            num_rows="dynamic",
            use_container_width=True,
            key=f"sp_editor_{sel_id}",
        )

        # ── threshold (embed_match 슬롯에만 표시)
        if sel.get("comparator") == "embed_match":
            tc1, tc2 = st.columns(2)
            new_thr_ok = tc1.slider(
                "threshold_ok (이상이면 OK)",
                min_value=0.30,
                max_value=0.90,
                value=float(sel.get("threshold_ok") or 0.50),
                step=0.01,
            )
            new_thr_vio = tc2.slider(
                "threshold_violation (미만이면 VIOLATION)",
                min_value=0.20,
                max_value=0.85,
                value=float(sel.get("threshold_violation") or 0.48),
                step=0.01,
            )
        else:
            new_thr_ok = sel.get("threshold_ok")
            new_thr_vio = sel.get("threshold_violation")

        # ── severity
        sc1, sc2 = st.columns(2)
        sev_options = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]
        cur_v = sel.get("violation_severity") or "MEDIUM"
        cur_m = sel.get("missing_severity") or cur_v
        new_violation_sev = sc1.selectbox(
            "violation_severity",
            sev_options,
            index=sev_options.index(cur_v) if cur_v in sev_options else 2,
        )
        new_missing_sev = sc2.selectbox(
            "missing_severity",
            sev_options + ["(상속: violation_severity)"],
            index=(
                sev_options.index(cur_m)
                if cur_m in sev_options
                else len(sev_options)
            ),
        )

        # ── fix_example
        new_fix_example = st.text_area(
            "fix_example (시정 예시)",
            value=sel.get("fix_example", "") or "",
            height=100,
        )

        # ── 미리보기 옵션
        show_diff = st.checkbox("💾 저장 전 변경 diff 미리보기", value=True)

        submitted = st.form_submit_button("💾 변경 사항 저장", type="primary", use_container_width=True)

    # ─── 저장 처리 ─────────────────────────
    if submitted:
        # search_phrases 정리 (빈칸 제거)
        sp_list: list[str] = []
        if hasattr(new_search_phrases, "to_dict"):
            for row in new_search_phrases.to_dict(orient="records"):
                v = row.get("search_phrase")
                if v and str(v).strip():
                    sp_list.append(str(v).strip())

        # 새 슬롯 dict 구성 (기존 필드 보존 + 변경 필드 적용)
        new_slot = dict(sel)
        new_slot["extract_target"] = new_extract_target
        if sel.get("comparator") == "embed_match" or sp_list:
            new_slot["search_phrases"] = sp_list
        if sel.get("comparator") == "embed_match":
            new_slot["threshold_ok"] = float(new_thr_ok)
            new_slot["threshold_violation"] = float(new_thr_vio)
        new_slot["violation_severity"] = new_violation_sev
        if new_missing_sev == "(상속: violation_severity)":
            new_slot.pop("missing_severity", None)
        else:
            new_slot["missing_severity"] = new_missing_sev
        new_slot["fix_example"] = new_fix_example

        # diff 미리보기 (실제 저장은 즉시 — Streamlit form 한계상 2단계 confirm 어려움)
        before_text = slot_writer.slot_to_yaml_block(sel)
        after_text = slot_writer.slot_to_yaml_block(new_slot)

        if show_diff:
            st.markdown("#### 변경 diff")
            render_diff(before_text, after_text, label_before=sel_id, label_after=f"{sel_id} (수정 후)")

        try:
            backup_dir = slot_writer.save_slot_edit(sel_id, new_slot)
            st.success(
                f"✅ 저장 완료. 백업: `{backup_dir.relative_to(_ROOT)}`\n\n"
                "검토 앱(8501) 캐시도 자동 무효화되어 다음 검토부터 변경 반영됩니다."
            )
            st.cache_data.clear()
        except Exception as e:
            st.error(f"❌ 저장 실패: {type(e).__name__}: {e}")


# ─── 일괄 작업 ─────────────────────────────
st.divider()
with st.expander("🔧 일괄 작업 (필터된 슬롯에 적용)", expanded=False):
    if not filtered:
        st.info("필터된 슬롯 없음.")
    else:
        st.warning(
            f"⚠️ 현재 필터된 **{len(filtered)}**개 슬롯에 일괄 적용합니다. "
            "신중히 사용하세요."
        )

        op = st.radio(
            "일괄 작업 종류",
            ["severity 일괄 변경", "threshold 일괄 변경 (embed_match만)"],
            horizontal=True,
        )

        if op == "severity 일괄 변경":
            new_sev = st.selectbox("새 violation_severity", ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"])
            confirm = st.checkbox(f"✅ 위 {len(filtered)}개 슬롯의 severity를 `{new_sev}`로 변경 확인")
            if st.button("🔄 일괄 적용", disabled=not confirm):
                updates = {}
                for s in filtered:
                    new_s = dict(s)
                    new_s["violation_severity"] = new_sev
                    updates[s["slot_id"]] = new_s
                try:
                    bd = slot_writer.save_bulk_edit(updates, reason="bulk_severity")
                    st.success(f"✅ {len(updates)}개 슬롯 severity → {new_sev}. 백업: `{bd.relative_to(_ROOT)}`")
                    st.cache_data.clear()
                except Exception as e:
                    st.error(f"❌ 실패: {e}")

        else:  # threshold 일괄
            embed_filtered = [s for s in filtered if s.get("comparator") == "embed_match"]
            if not embed_filtered:
                st.info("필터된 슬롯 중 embed_match 가 없습니다.")
            else:
                tc1, tc2 = st.columns(2)
                bulk_ok = tc1.slider("threshold_ok", 0.30, 0.90, 0.50, step=0.01)
                bulk_vio = tc2.slider("threshold_violation", 0.20, 0.85, 0.48, step=0.01)
                confirm = st.checkbox(
                    f"✅ embed_match {len(embed_filtered)}개에 OK={bulk_ok}, VIOLATION={bulk_vio} 적용 확인"
                )
                if st.button("🔄 일괄 적용 (threshold)", disabled=not confirm):
                    updates = {}
                    for s in embed_filtered:
                        new_s = dict(s)
                        new_s["threshold_ok"] = float(bulk_ok)
                        new_s["threshold_violation"] = float(bulk_vio)
                        updates[s["slot_id"]] = new_s
                    try:
                        bd = slot_writer.save_bulk_edit(updates, reason="bulk_threshold")
                        st.success(
                            f"✅ {len(updates)}개 슬롯 threshold 일괄 변경. 백업: `{bd.relative_to(_ROOT)}`"
                        )
                        st.cache_data.clear()
                    except Exception as e:
                        st.error(f"❌ 실패: {e}")
