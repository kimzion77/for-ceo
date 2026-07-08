"""LLM 모델 A/B 비교 페이지.

같은 사업장 파일을 두 모델로 각각 검토하고 결과·시간·캐시 hit 을 비교.
최적 모델을 찾아가기 위한 도구.

흐름:
  1. 비교할 두 모델 선택 (A · B)
  2. 비교 대상 사업장 파일 업로드 (또는 samples/ 에서 선택)
  3. "비교 실행" 버튼:
     - 모델 A 로 검토 (1회) → 결과·시간 측정
     - 모델 B 로 검토 (1회) → 결과·시간 측정
     - 분포 차이·소요 시간 차이·캐시 hit 여부 표시
  4. 결과 비교 카드 + 세부 차이 테이블 (어느 슬롯이 다른 결과를 냈는지)

원래 활성 모델은 비교 종료 시 복구.
"""
from __future__ import annotations

import sys
import tempfile
import time
from collections import Counter
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[4]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import pandas as pd
import plotly.express as px
import streamlit as st

from cgr.run import review_file
from cgr.verdict import classify
from cgr.web.admin.auth import require_login
from cgr.web.admin.theme import inject_civic_theme
from cgr.store import settings_store
from cgr.web.admin.ui_common import page_header


st.set_page_config(page_title="모델 비교", page_icon="⚖️", layout="wide")
inject_civic_theme()
require_login()
page_header(
    "LLM 모델 A/B 비교",
    icon="⚖️",
    description="같은 사업장 본문을 두 모델로 각각 검토 → 결과·시간·정확도 비교. 최적 모델 찾기.",
)


# ─── 1. 모델 선택 ──────────────────────────
MODEL_OPTIONS = [
    "gpt-5.5",
    "gpt-5.5-mini",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5",
    "gpt-5-mini",
    "gpt-4o",
    "gpt-4o-mini",
]

cur_model = settings_store.get("llm_model", "gpt-5.4-mini")

st.markdown("### 1️⃣ 비교할 두 모델 선택")
mc1, mc2 = st.columns(2)
model_a = mc1.selectbox(
    "🅰 모델 A (기준)",
    MODEL_OPTIONS,
    index=MODEL_OPTIONS.index(cur_model) if cur_model in MODEL_OPTIONS else 3,
    key="model_a",
    help="현재 활성 모델 추천",
)
model_b = mc2.selectbox(
    "🅱 모델 B (비교)",
    MODEL_OPTIONS,
    index=(MODEL_OPTIONS.index(cur_model) + 1) % len(MODEL_OPTIONS) if cur_model in MODEL_OPTIONS else 2,
    key="model_b",
    help="A보다 다른 단계 (상위/하위) 권장",
)

if model_a == model_b:
    st.warning("⚠️ 두 모델이 같습니다. 다른 모델을 선택하세요.")
    st.stop()

st.caption(f"현재 시스템 활성 모델: **`{cur_model}`** (비교 종료 후 복구됨)")
st.divider()


# ─── 2. 비교 대상 파일 ─────────────────────
st.markdown("### 2️⃣ 비교 대상 사업장 파일")
SAMPLES_DIR = _ROOT / "samples"
sample_files = sorted([p for p in SAMPLES_DIR.glob("*.*") if p.suffix.lower() in (".docx", ".hwp", ".hwpx", ".pdf", ".txt")]) if SAMPLES_DIR.exists() else []

source = st.radio(
    "파일 출처",
    ["📂 samples/ 에서 선택", "⬆️ 업로드"],
    horizontal=True,
)

tmp_path: Path | None = None
display_name = ""

if source == "📂 samples/ 에서 선택":
    if not sample_files:
        st.warning("samples/ 디렉토리에 파일이 없습니다. 업로드를 사용하세요.")
    else:
        chosen = st.selectbox("샘플 파일", sample_files, format_func=lambda p: p.name)
        tmp_path = chosen
        display_name = chosen.name
else:
    uploaded = st.file_uploader("비교용 파일 업로드", type=["docx", "hwp", "hwpx", "pdf", "txt"])
    if uploaded:
        suffix = Path(uploaded.name).suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tf:
            tf.write(uploaded.getbuffer())
            tmp_path = Path(tf.name)
        display_name = uploaded.name

if not tmp_path:
    st.info("위에서 파일을 선택·업로드하세요.")
    st.stop()

st.caption(f"📄 대상: `{display_name}` ({tmp_path.stat().st_size:,} bytes)")
st.divider()


# ─── 3. 실행 ───────────────────────────────
st.markdown("### 3️⃣ 비교 실행")
st.caption(
    "두 모델로 각각 1회씩 검토. 캐시 hit 시 0초대. miss 시 모델당 약 15~30초 소요."
)

if st.button("▶️ 비교 실행", type="primary", use_container_width=True):
    catalog_path = _ROOT / "data" / "slots" / "atomic_slots_v0.yaml"
    original_model = settings_store.get("llm_model", "gpt-5.4-mini")

    results = {}
    errors = {}
    for label, model in (("A", model_a), ("B", model_b)):
        st.markdown(f"#### 🔄 {label} = `{model}` 검토 중…")
        # 활성 모델 임시 변경
        s_settings = settings_store.load()
        s_settings["llm_model"] = model
        settings_store.save(s_settings, backup=False)

        # 검토
        t0 = time.time()
        try:
            with st.spinner(f"{label}: `{model}` 로 검토 중..."):
                report = review_file(tmp_path, catalog_path)
            elapsed = time.time() - t0
            results[label] = {
                "model": model,
                "report": report,
                "elapsed": elapsed,
            }
            st.success(f"✅ {label} = `{model}` 완료 ({elapsed:.1f}s)")
        except Exception as e:
            errors[label] = str(e)
            st.error(f"❌ {label} = `{model}` 실패: {type(e).__name__}: {e}")

    # 원래 모델로 복구
    s_settings = settings_store.load()
    s_settings["llm_model"] = original_model
    settings_store.save(s_settings, backup=False)
    st.caption(f"🔄 시스템 활성 모델 복구: `{original_model}`")

    if len(results) < 2:
        st.stop()

    st.session_state["_compare_results"] = results


# ─── 4. 결과 비교 ──────────────────────────
results = st.session_state.get("_compare_results")
if not results:
    st.info("▶️ 비교 실행 버튼을 눌러 두 모델 결과를 받아오세요.")
    st.stop()

st.divider()
st.markdown("### 4️⃣ 비교 결과")

# 분포 비교 카드
st.markdown("#### 📊 분포 비교")
cmp_cols = st.columns(2)
for col, label in zip(cmp_cols, ["A", "B"]):
    r = results[label]
    rep = r["report"]
    with col:
        st.markdown(f"##### 🅰🅱[{label}] `{r['model']}` · {r['elapsed']:.1f}s")
        dist = dict(rep.summary)
        st.metric("종합 판정", rep.overall_label)
        kc = st.columns(5)
        kc[0].metric("🔴 누락", dist.get("누락", 0))
        kc[1].metric("🟠 위반", dist.get("위반", 0))
        kc[2].metric("🟡 주의", dist.get("주의", 0))
        kc[3].metric("🟣 검토필요", dist.get("검토필요", 0))
        kc[4].metric("✅ 적정", dist.get("적정", 0))


# 차이 메트릭
st.markdown("#### 🔀 모델별 차이")
da, db = results["A"], results["B"]
diff_rows = []
for k in ("누락", "위반", "주의", "검토필요", "적정"):
    va = da["report"].summary.get(k, 0)
    vb = db["report"].summary.get(k, 0)
    diff_rows.append({"버킷": k, "A": va, "B": vb, "차이 (B-A)": vb - va})

df_diff = pd.DataFrame(diff_rows)
diff_cols = st.columns([2, 1, 1])
diff_cols[0].dataframe(df_diff, hide_index=True, use_container_width=True)
diff_cols[1].metric(
    "⏱ 시간 차이",
    f"{db['elapsed'] - da['elapsed']:+.1f}s",
    help=f"A: {da['elapsed']:.1f}s · B: {db['elapsed']:.1f}s",
)
total_a = sum(da["report"].summary.values())
total_b = sum(db["report"].summary.values())
slot_diff = sum(
    abs(da["report"].summary.get(k, 0) - db["report"].summary.get(k, 0))
    for k in ("누락", "위반", "주의", "검토필요", "적정")
)
diff_cols[2].metric(
    "🔀 분류 차이",
    f"{slot_diff}건",
    help="두 모델이 다르게 분류한 슬롯 수의 추정치",
)


# 슬롯 레벨 차이 — 어느 슬롯이 다르게 잡혔는지
st.markdown("#### 🎯 슬롯별 분류 차이")
slot_a = {f.slot_id: classify(f) for ar in da["report"].article_results for f in ar.findings}
slot_b = {f.slot_id: classify(f) for ar in db["report"].article_results for f in ar.findings}

diff_slots = []
all_ids = set(slot_a) | set(slot_b)
for sid in sorted(all_ids):
    ba = slot_a.get(sid, "?")
    bb = slot_b.get(sid, "?")
    if ba != bb:
        diff_slots.append({"slot_id": sid, f"A ({da['model']})": ba, f"B ({db['model']})": bb})

if diff_slots:
    st.caption(f"🔍 두 모델이 다른 결과를 낸 슬롯: **{len(diff_slots)}건**")
    st.dataframe(pd.DataFrame(diff_slots), hide_index=True, use_container_width=True, height=400)
else:
    st.success("✅ 두 모델이 모든 슬롯에서 같은 결과. 분류 안정성 높음.")


# 분포 차트
st.markdown("#### 📈 분포 시각화")
chart_rows = []
for label in ("A", "B"):
    r = results[label]
    for k, v in r["report"].summary.items():
        chart_rows.append({"모델": f"{label}: {r['model']}", "버킷": k, "건수": v})

df_chart = pd.DataFrame(chart_rows)
fig = px.bar(
    df_chart,
    x="모델",
    y="건수",
    color="버킷",
    barmode="group",
    title="모델별 버킷 분포 비교",
    color_discrete_map={
        "누락": "#dc2626",
        "위반": "#ea580c",
        "주의": "#facc15",
        "검토필요": "#a855f7",
        "적정": "#22c55e",
    },
)
st.plotly_chart(fig, use_container_width=True)


# 결과 초기화
st.divider()
if st.button("🧹 비교 결과 초기화"):
    st.session_state.pop("_compare_results", None)
    st.rerun()
