"""자율점검 서비스 관리자 대시보드 — 파이프라인 플로우.

좌측 사이드바는 데이터 처리 단계 순서로 정렬:
  01 📚 마스터DB        — 슬롯·법령·주제·룰 카탈로그
  02 📋 슬롯편집        — 슬롯 yaml 직접 편집
  03 📝 프롬프트편집     — extractor·explainer 프롬프트
  04 📊 검토이력        — 사업장별 검토 결과 통계
  05 🗂 데이터관계      — 슬롯 ↔ 주제 ↔ 법령 그래프
  06 ⚖️ 모델비교        — LLM A/B 비교
  07 💾 캐시관리        — LLM 응답 캐시
  08 ⚙️ 시스템설정      — 임계값·모델·DB 버전
  09 📈 방문통계        — 누적 방문·이벤트

본 홈 화면은 위 9개 페이지 + 백엔드 데이터의 현재 상태를 한 눈에 보여주는
**파이프라인 플로우 대시보드**.

실행:
    python launch_admin.py    # port 8502
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import streamlit as st

from cgr import db as _db
from cgr import llm_cache
from cgr.config import get_api_key, get_llm_model, get_embed_model
from cgr.master_db import get_master_db, _resolve_path as _resolve_db_path
from cgr.web.admin.auth import require_login
from cgr.web.admin.store import access_log, prompt_writer
from cgr.web.admin.theme import (
    hero,
    inject_civic_theme,
    section_header,
)
from cgr.web.admin.ui_common import data_dir, backups_dir


st.set_page_config(
    page_title="자율점검 서비스 관리자",
    page_icon="🛠",
    layout="wide",
    initial_sidebar_state="expanded",
)
inject_civic_theme()
require_login()


# 방문 로그 (세션당 1회)
if "_admin_visit_logged" not in st.session_state:
    try:
        from cgr.web.admin.store.access_log import log_event
        log_event(service="관리자", action="visit")
    except Exception:
        pass
    st.session_state["_admin_visit_logged"] = True


# ─── 사이드바: 환경 정보 ──────────────────────
with st.sidebar:
    st.markdown("### 🛠 관리자")
    st.caption("port 8502")
    st.divider()
    st.markdown("#### ⚙️ 환경")
    try:
        api_key = get_api_key()
        st.success(f"OpenAI Key …{api_key[-6:]}")
    except Exception:
        st.error("OpenAI API Key 미설정")
    st.caption(f"LLM: `{get_llm_model()}`")
    st.caption(f"임베딩: `{get_embed_model()}`")
    st.divider()
    st.markdown("#### 📚 마스터 DB")
    try:
        db_path = _resolve_db_path()
        db = get_master_db()
        st.success(f"{len(db.all_articles())}개 조 로드")
        ver = "2026" if "2026" in db_path.name else "2025"
        st.caption(f"버전: **{ver}판**")
        st.caption(f"`{db_path.name}`")
    except Exception as e:
        st.warning(f"DB: {e}")


# ─── Hero ──────────────────────────────────────
hero(
    title="자율점검 서비스 관리자 대시보드",
    subtitle="데이터 처리 파이프라인 — 마스터 → 사업장 → 문서 → 구조화 → 검토 → 위반·권고 → 수정 → 운영",
    icon="🛠",
)


# ─── 데이터 수집 ──────────────────────────────
@st.cache_data(ttl=15)
def _table_counts() -> dict[str, int]:
    try:
        return _db.table_counts()
    except Exception:
        return {}


@st.cache_data(ttl=15)
def _query_one(sql: str, params: tuple = ()):
    try:
        with _db.connect() as conn:
            return dict(conn.execute(sql, params).fetchone() or {})
    except Exception:
        return {}


counts = _table_counts()

# 글로벌 KPI
g1, g2, g3, g4 = st.columns(4)
g1.metric(
    "총 검토 실행",
    f"{counts.get('inspection_run', 0) + counts.get('audit_case', 0):,}",
    help="inspection_run (계산형 룰) + audit_case (LLM 판단형) 합산",
)
g2.metric("등록 사업장", f"{counts.get('workplace', 0):,}")
g3.metric("문서 누적", f"{counts.get('payslip_document', 0):,}")
_open_q = _query_one(
    "SELECT COUNT(*) AS n FROM violation_finding WHERE status='OPEN'"
)
g4.metric(
    "OPEN 위반",
    f"{int(_open_q.get('n', 0)):,}",
    help="아직 시정되지 않은 위반",
)


# ─── 파이프라인 플로우 ────────────────────────
section_header(
    "데이터 처리 파이프라인",
    "각 단계의 현재 상태와 누적 카운트. 단계명을 클릭하면 상세 페이지로.",
)


# 색상 정의 (inline)
_PIPE_BG = "#FFFFFF"
_PIPE_BORDER = "#DBE2EA"
_PIPE_BRAND = "#0B3D91"
_PIPE_BRAND_SOFT = "#E5ECF8"
_PIPE_TEXT = "#0F1B2D"
_PIPE_MUTED = "#475569"
_PIPE_SUBTLE = "#7B8794"
_PIPE_OK = "#22c55e"
_PIPE_IDLE = "#C2CCD8"
_PIPE_WARN = "#ea580c"


def _pipe_stage(
    *,
    step: int,
    icon: str,
    title: str,
    page_link: str | None,
    metrics: list[tuple[str, str]],
    status: str = "ok",  # ok / idle / warn
) -> str:
    """파이프라인 단계 카드 1개의 HTML."""
    status_color = {
        "ok": _PIPE_OK,
        "warn": _PIPE_WARN,
        "idle": _PIPE_IDLE,
    }.get(status, _PIPE_IDLE)
    status_dot = (
        f'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;'
        f'background:{status_color};margin-right:6px;"></span>'
    )
    metric_html = "".join(
        f'<div style="display:flex;justify-content:space-between;'
        f'font-size:11.5px;line-height:1.6;color:{_PIPE_MUTED};">'
        f'<span>{k}</span>'
        f'<b style="color:{_PIPE_TEXT};font-feature-settings:\'tnum\';">{v}</b>'
        f'</div>'
        for k, v in metrics
    )
    link_html = (
        f'<a href="{page_link}" target="_self" style="display:inline-block;margin-top:10px;'
        f'font-size:11px;font-weight:600;color:{_PIPE_BRAND};text-decoration:none;">'
        f'페이지 열기 →</a>'
        if page_link else
        f'<div style="margin-top:10px;font-size:11px;color:{_PIPE_SUBTLE};">'
        f'(전용 페이지 미생성 — Phase 7 후속)</div>'
    )
    return (
        f'<div style="background:{_PIPE_BG};border:1px solid {_PIPE_BORDER};'
        f'border-radius:14px;padding:14px 16px;height:100%;'
        f'box-shadow:0 1px 2px rgba(15,27,45,0.04);">'
        f'<div style="display:flex;align-items:center;justify-content:space-between;'
        f'margin-bottom:8px;">'
        f'<div style="font-size:11px;color:{_PIPE_BRAND};font-weight:700;'
        f'letter-spacing:0.5px;">STEP {step}</div>'
        f'<div style="font-size:10.5px;color:{_PIPE_SUBTLE};">{status_dot}{status.upper()}</div>'
        f'</div>'
        f'<div style="font-size:14px;font-weight:700;color:{_PIPE_TEXT};'
        f'margin-bottom:8px;">{icon} {title}</div>'
        f'<div style="border-top:1px solid {_PIPE_BORDER};padding-top:8px;">'
        f'{metric_html}'
        f'</div>'
        f'{link_html}'
        f'</div>'
    )


# 파이프라인 메트릭 수집
n_check_item = counts.get("check_item", 0)
n_topic_section = counts.get("topic_section", 0)
n_law_article = counts.get("law_article", 0)
n_violation_type = counts.get("violation_type", 0)
n_workplace = counts.get("workplace", 0)
n_employee = counts.get("employee", 0)
n_pd = counts.get("payslip_document", 0)
n_ocr = counts.get("payslip_ocr_raw", 0)
n_payslip = counts.get("payslip", 0)
n_line = counts.get("payslip_line", 0)
n_run = counts.get("inspection_run", 0)
n_audit = counts.get("audit_case", 0)
n_finding = counts.get("violation_finding", 0)
n_rec = counts.get("recommendation", 0)
n_correction = counts.get("correction_log", 0)


# Streamlit page 라우팅: 멀티 페이지 앱은 `/?page=name` 또는 사이드바 클릭으로만 이동.
# Streamlit 1.x 에선 직접 link 가 까다로워 — page_link 는 None 으로 두고
# 사용자가 사이드바에서 클릭하도록 안내. 단, Streamlit 1.30+ 에선 st.page_link 사용 가능.
def _safe_page_link(target: str | None) -> str | None:
    return None  # 1.x 호환 우선 — UI 카드 자체를 정보용으로


# 1행 — 준비 (마스터)
section_header("1️⃣ 준비 — 마스터 데이터", "검토에 쓰이는 reference 자산")
row1 = st.columns(3)
with row1[0]:
    st.markdown(_pipe_stage(
        step=1, icon="📚", title="마스터 카탈로그",
        page_link=_safe_page_link("master_db"),
        metrics=[
            ("슬롯 (check_item)", f"{n_check_item:,}"),
            ("주제 섹션", f"{n_topic_section:,}"),
            ("법령 조문", f"{n_law_article:,}"),
            ("위반 카탈로그", f"{n_violation_type:,}"),
        ],
        status="ok" if n_check_item > 0 else "idle",
    ), unsafe_allow_html=True)
with row1[1]:
    st.markdown(_pipe_stage(
        step=2, icon="📋", title="슬롯·프롬프트",
        page_link=_safe_page_link("slot"),
        metrics=[
            ("취업규칙 슬롯", f"{_query_one('SELECT COUNT(*) AS n FROM check_item ci JOIN document_type dt ON dt.id = ci.document_type_id WHERE dt.code = ?', ('work_rules',)).get('n', 0):,}"),
            ("근로계약서 슬롯", f"{_query_one('SELECT COUNT(*) AS n FROM check_item ci JOIN document_type dt ON dt.id = ci.document_type_id WHERE dt.code = ?', ('employment_contract',)).get('n', 0):,}"),
            ("임금명세서 슬롯", f"{_query_one('SELECT COUNT(*) AS n FROM check_item ci JOIN document_type dt ON dt.id = ci.document_type_id WHERE dt.code = ?', ('wage_statement',)).get('n', 0):,}"),
            ("프롬프트 사용자화", "✓" if any(v.get("diverged") for v in prompt_writer.stats().values()) else "기본값"),
        ],
        status="ok",
    ), unsafe_allow_html=True)
with row1[2]:
    cur = _query_one("SELECT year, hourly_amount FROM v_minimum_wage_current")
    st.markdown(_pipe_stage(
        step=3, icon="💰", title="계산형 룰 마스터",
        page_link=_safe_page_link("master_db"),
        metrics=[
            ("최저임금 (현행)", f"{int(cur.get('hourly_amount', 0)):,}원/h" if cur else "—"),
            ("적용 연도", f"{int(cur.get('year', 0))}년" if cur else "—"),
            ("임금항목", f"{counts.get('wage_item_catalog', 0):,}"),
            ("위반유형", f"{n_violation_type:,}"),
        ],
        status="ok" if n_violation_type > 0 else "idle",
    ), unsafe_allow_html=True)

st.write("")

# 2행 — 수집 (사업장·문서)
section_header(
    "2️⃣ 수집 — 사업장·문서 입수",
    "사업장 등록 → 임금명세서 업로드 → OCR (PII 비식별화)",
)
row2 = st.columns(3)
with row2[0]:
    st.markdown(_pipe_stage(
        step=4, icon="🏢", title="사업장 · 근로자",
        page_link=None,
        metrics=[
            ("사업장 (workplace)", f"{n_workplace:,}"),
            ("근로자 (employee)", f"{n_employee:,}"),
            ("PII 처리", "SHA-256 + 마스킹"),
        ],
        status="ok" if n_workplace > 0 else "idle",
    ), unsafe_allow_html=True)
with row2[1]:
    st.markdown(_pipe_stage(
        step=5, icon="📥", title="문서 업로드",
        page_link=None,
        metrics=[
            ("문서 (payslip_document)", f"{n_pd:,}"),
            ("OCR raw", f"{n_ocr:,}"),
            ("교부 의무", "근기법 §48 ②"),
        ],
        status="ok" if n_pd > 0 else "idle",
    ), unsafe_allow_html=True)
with row2[2]:
    pct = (n_payslip / n_pd * 100) if n_pd else 0
    st.markdown(_pipe_stage(
        step=6, icon="🧾", title="구조화 (사용자 확정)",
        page_link=None,
        metrics=[
            ("payslip (확정)", f"{n_payslip:,}"),
            ("payslip_line (1:N)", f"{n_line:,}"),
            ("확정률", f"{pct:.0f}%" if n_pd else "—"),
        ],
        status="ok" if n_payslip > 0 else "idle",
    ), unsafe_allow_html=True)

st.write("")

# 3행 — 검토·권고
section_header(
    "3️⃣ 검토 — 룰엔진 + LLM 하이브리드",
    "계산형(rule_engine.py) + 판단형(LLM analyze) 동시 실행",
)
row3 = st.columns(3)
n_open = _query_one("SELECT COUNT(*) AS n FROM violation_finding WHERE status='OPEN'").get("n", 0)
n_fixed = _query_one("SELECT COUNT(*) AS n FROM violation_finding WHERE status='FIXED'").get("n", 0)
with row3[0]:
    st.markdown(_pipe_stage(
        step=7, icon="🔍", title="검토 실행",
        page_link=_safe_page_link("review_history"),
        metrics=[
            ("계산형 (inspection_run)", f"{n_run:,}"),
            ("판단형 (audit_case)", f"{n_audit:,}"),
            ("LLM 캐시", f"{llm_cache.stats().get('entries', 0):,}"),
        ],
        status="ok" if (n_run + n_audit) > 0 else "idle",
    ), unsafe_allow_html=True)
with row3[1]:
    sev_high = _query_one(
        "SELECT COUNT(*) AS n FROM violation_finding vf "
        "JOIN violation_type vt ON vt.violation_code = vf.violation_code "
        "WHERE vt.severity = 'HIGH'"
    ).get("n", 0)
    st.markdown(_pipe_stage(
        step=8, icon="💡", title="위반 · 권고",
        page_link=None,
        metrics=[
            ("위반 발견", f"{n_finding:,}"),
            ("HIGH 등급", f"{sev_high:,}"),
            ("권고 생성", f"{n_rec:,}"),
            ("OPEN", f"{n_open:,}"),
        ],
        status="warn" if n_open > 0 else ("ok" if n_finding > 0 else "idle"),
    ), unsafe_allow_html=True)
with row3[2]:
    pct_fixed = (n_fixed / n_finding * 100) if n_finding else 0
    st.markdown(_pipe_stage(
        step=9, icon="✏️", title="수정 반영",
        page_link=None,
        metrics=[
            ("수정 이력", f"{n_correction:,}"),
            ("FIXED 위반", f"{n_fixed:,}"),
            ("시정률", f"{pct_fixed:.0f}%" if n_finding else "—"),
        ],
        status="ok" if n_fixed > 0 else "idle",
    ), unsafe_allow_html=True)

st.write("")

# ─── 운영 영역 ──────────────────────────────
section_header(
    "⚙️ 운영 — 시스템 자원·통계",
    "캐시·설정·방문통계·모델비교 — 사이드바에서 직접 이동",
)
ops_cache = llm_cache.stats() if True else {}
try:
    ops_cache = llm_cache.stats()
except Exception:
    ops_cache = {}
access_stats = access_log.stats()
op1, op2, op3, op4 = st.columns(4)
op1.metric(
    "💾 LLM 캐시", f"{ops_cache.get('entries', 0):,}",
    help=f"{ops_cache.get('size_kb', 0):,} KB",
)
op2.metric(
    "📈 누적 방문",
    f"{access_stats.get('n_total', 0):,}",
    help=f"7일 {access_stats.get('n_7d', 0):,} · 30일 {access_stats.get('n_30d', 0):,}",
)
op3.metric(
    "🗄 백업",
    f"{len([d for d in backups_dir().iterdir() if d.is_dir()]):,}개",
)
op4.metric(
    "🌐 활성 서비스",
    f"{len([k for k, v in (access_stats.get('by_service') or {}).items() if v > 0]):,}",
)

st.write("")

# ─── 사이드바 안내 ──────────────────────────
section_header(
    "🗂 페이지 안내 — 좌측 사이드바 순서",
    "단계별로 묶음. 클릭하면 해당 페이지로 이동.",
)
st.markdown(
    """
| # | 페이지 | 단계 | 기능 |
|---|---|---|---|
| 01 | 📚 마스터DB | 준비 | 27 테이블 + 2 뷰 브라우징, 슬롯 풀컨텍스트, 매핑 검증, 계산형 룰, 검토 이력 |
| 02 | 📋 슬롯편집 | 준비 | yaml 슬롯 직접 편집 (search_phrases·threshold·severity·fix_example) |
| 03 | 📝 프롬프트편집 | 준비 | extractor·explainer 프롬프트 사용자화 + 롤백 |
| 04 | 📊 검토이력 | 결과 | 사업장별 누적·통계 차트·빈출 슬롯 Top 10 |
| 05 | 🗂 데이터관계 | 결과 | 슬롯 ↔ 주제 ↔ 법령 sunburst·heatmap |
| 06 | ⚖️ 모델비교 | 결과 | 같은 사업장 두 모델로 비교 — A/B 검증 |
| 07 | 💾 캐시관리 | 운영 | LLM 응답 캐시 항목별 조회·삭제 |
| 08 | ⚙️ 시스템설정 | 운영 | 임베딩 임계값 · 모델 선택 · DB 버전 |
| 09 | 📈 방문통계 | 운영 | 서비스별 방문·이벤트 누적 + 시간대 분포 |
"""
)

st.write("")

# ─── 푸터 ────────────────────────────────────
st.caption(
    "취업규칙·근로계약서·임금명세서 자율점검 서비스 관리자 v2.0 · "
    f"검토 앱 port 8501 · 관리자 8502 · API 8503 · "
    f"db: `{_db.get_db_path().name}`"
)
