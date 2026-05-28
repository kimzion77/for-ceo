"""LLM 캐시 관리 페이지.

기능:
  - 캐시 항목 테이블 (해시·type·KB·mtime)
  - 키워드 검색 + 모델/type 필터
  - 선택 일괄 삭제 / 전체 비우기 (선택 시 백업)
  - 모델·type 별 통계 차트

캐시 type 추론:
  - payload 에 'rewrites' 키 있음 → explainer
  - payload 에 'extractions' 키 있음 → extractor
  - 그 외 → unknown
"""
from __future__ import annotations

import json
import shutil
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[4]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import pandas as pd
import plotly.express as px
import streamlit as st

from cgr import llm_cache
from cgr.web.admin.auth import require_login
from cgr.web.admin.theme import inject_civic_theme
from cgr.web.admin.ui_common import backups_dir, page_header

st.set_page_config(page_title="캐시 관리", page_icon="💾", layout="wide")
inject_civic_theme()
require_login()
page_header(
    "LLM 캐시 관리",
    icon="💾",
    description="data/llm_cache/ 디스크 캐시 항목별 조회·삭제. 변경 시 다음 검토에서 LLM 재호출.",
)


def _classify_payload(payload: dict) -> str:
    if not isinstance(payload, dict):
        return "unknown"
    if "rewrites" in payload:
        return "explainer"
    if "extractions" in payload:
        return "extractor"
    return "unknown"


@st.cache_data(ttl=5)
def _scan_cache() -> list[dict]:
    """캐시 디렉토리 스캔. 각 파일의 메타 추출."""
    cache_dir = llm_cache.CACHE_DIR
    if not cache_dir.exists():
        return []
    rows = []
    for f in cache_dir.glob("*.json"):
        try:
            stat = f.stat()
            # 파일 본문 파싱 시도 (메타만 추출)
            try:
                content = f.read_text(encoding="utf-8")
                payload = json.loads(content)
            except Exception:
                payload = {}
            type_ = _classify_payload(payload)
            n_items = 0
            if type_ == "explainer":
                n_items = len(payload.get("rewrites") or [])
            elif type_ == "extractor":
                n_items = len(payload.get("extractions") or [])
            rows.append(
                {
                    "key": f.stem,
                    "type": type_,
                    "n_items": n_items,
                    "size_kb": stat.st_size // 1024,
                    "size_bytes": stat.st_size,
                    "mtime": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
                    "path": str(f),
                }
            )
        except Exception:
            pass
    return sorted(rows, key=lambda r: r["mtime"], reverse=True)


# ─── 통계 KPI ───────────────────────────
items = _scan_cache()
all_stats = llm_cache.stats()
total_kb = all_stats.get("size_kb", 0)

cols = st.columns(4)
cols[0].metric("총 항목", f"{len(items):,}")
cols[1].metric("총 용량", f"{total_kb:,} KB")
n_explainer = sum(1 for it in items if it["type"] == "explainer")
n_extractor = sum(1 for it in items if it["type"] == "extractor")
cols[2].metric("explainer", n_explainer)
cols[3].metric("extractor", n_extractor)

st.divider()


# ─── 차트 ────────────────────────────────
if items:
    cc1, cc2 = st.columns(2)
    with cc1:
        type_counts = Counter(it["type"] for it in items)
        df_t = pd.DataFrame({"type": list(type_counts.keys()), "건수": list(type_counts.values())})
        fig = px.pie(df_t, names="type", values="건수", title="type 분포", hole=0.4)
        st.plotly_chart(fig, use_container_width=True)
    with cc2:
        # type 별 KB 합계
        kb_by_type: dict[str, int] = {}
        for it in items:
            kb_by_type[it["type"]] = kb_by_type.get(it["type"], 0) + it["size_kb"]
        df_kb = pd.DataFrame({"type": list(kb_by_type.keys()), "KB": list(kb_by_type.values())})
        fig2 = px.bar(df_kb, x="type", y="KB", title="type 별 용량")
        st.plotly_chart(fig2, use_container_width=True)


# ─── 필터 + 테이블 ───────────────────────
st.markdown("### 캐시 항목 테이블")
fc1, fc2, fc3 = st.columns([1.5, 1, 2])

f_type = fc1.multiselect("type", ["explainer", "extractor", "unknown"], default=[])
f_min_kb = fc2.number_input("최소 KB", min_value=0, value=0, step=1)
f_search = fc3.text_input("키 (해시) 검색")


def _row_match(it: dict) -> bool:
    if f_type and it["type"] not in f_type:
        return False
    if f_min_kb and it["size_kb"] < f_min_kb:
        return False
    if f_search and f_search not in it["key"]:
        return False
    return True


filtered_items = [it for it in items if _row_match(it)]
st.caption(f"필터 결과: **{len(filtered_items)}**개 / 전체 {len(items)}개")


df = pd.DataFrame(
    [
        {
            "key": it["key"],
            "type": it["type"],
            "항목 수": it["n_items"],
            "KB": it["size_kb"],
            "수정시각": it["mtime"],
        }
        for it in filtered_items
    ]
)

selection = st.dataframe(
    df,
    use_container_width=True,
    height=400,
    hide_index=True,
    selection_mode="multi-row",
    on_select="rerun",
)

selected_idx = selection.selection.rows if hasattr(selection, "selection") else []
selected_keys = [filtered_items[i]["key"] for i in selected_idx]


# ─── 선택 항목 동작 ──────────────────────
if selected_keys:
    st.markdown(f"#### 선택 항목 {len(selected_keys)}개")

    a1, a2 = st.columns(2)
    if a1.button("👁 첫 항목 미리보기", use_container_width=True):
        first = filtered_items[selected_idx[0]]
        try:
            with Path(first["path"]).open(encoding="utf-8") as fp:
                content = json.load(fp)
            st.json(content, expanded=False)
        except Exception as e:
            st.error(f"읽기 실패: {e}")

    confirm_del = a2.checkbox(f"✅ {len(selected_keys)}개 항목 삭제 확인")
    if a2.button("🗑 선택 항목 삭제", type="primary", disabled=not confirm_del, use_container_width=True):
        n_deleted = 0
        for it in filtered_items:
            if it["key"] in selected_keys:
                try:
                    Path(it["path"]).unlink()
                    n_deleted += 1
                except Exception:
                    pass
        st.success(f"✅ {n_deleted}개 항목 삭제 완료")
        st.cache_data.clear()
        st.rerun()


# ─── 일괄 작업 ───────────────────────────
st.divider()
with st.expander("⚠️ 일괄 작업 (전체 캐시)", expanded=False):
    st.warning(
        f"현재 **{len(items)}개** 항목 ({total_kb:,} KB) 전체에 적용됩니다. 신중히 사용하세요."
    )

    do_backup = st.checkbox("🗄 삭제 전 backups/ 에 압축 백업", value=True)
    confirm_all = st.checkbox(f"✅ {len(items)}개 캐시 전체 삭제 확인")

    if st.button("🧹 전체 캐시 비우기", type="primary", disabled=not confirm_all):
        # 백업
        if do_backup and items:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            bdir = backups_dir() / f"{ts}_cache_purge"
            bdir.mkdir(parents=True, exist_ok=True)
            for it in items:
                try:
                    shutil.copy2(it["path"], bdir / f"{it['key']}.json")
                except Exception:
                    pass
            st.info(f"📦 백업 완료: `{bdir.relative_to(_ROOT)}` ({len(items)}개)")

        # 삭제
        n = llm_cache.clear()
        st.success(f"✅ {n}개 항목 전체 삭제 완료. 다음 검토에서 LLM 재호출됩니다.")
        st.cache_data.clear()
        st.rerun()


# ─── type 별 일괄 삭제 ──────────────────
with st.expander("🎯 type 별 일괄 삭제"):
    type_target = st.selectbox(
        "삭제할 type",
        ["explainer", "extractor", "unknown"],
        help="새 사유 풀이 프롬프트 적용 시 explainer 만 삭제 권장",
    )
    target_items = [it for it in items if it["type"] == type_target]
    st.caption(f"대상: {len(target_items)}개")

    confirm_t = st.checkbox(f"✅ {type_target} {len(target_items)}개 삭제 확인", key="type_confirm")
    if st.button(f"🗑 {type_target} 일괄 삭제", disabled=not confirm_t):
        n_deleted = 0
        for it in target_items:
            try:
                Path(it["path"]).unlink()
                n_deleted += 1
            except Exception:
                pass
        st.success(f"✅ {n_deleted}개 ({type_target}) 삭제 완료")
        st.cache_data.clear()
        st.rerun()
