"""관리자 대시보드 — civic 디자인 토큰을 Streamlit 으로 이식.

프론트엔드 `frontend/src/styles/globals.css` 와 1:1 동일 팔레트.
- Pretendard Variable 폰트 CDN
- civic 네이비 (#0B3D91) + 다섯 위험도 색상
- shadow-sm / r-lg / 일관 spacing

호출 패턴
    from cgr.web.admin.theme import inject_civic_theme, hero, kpi_strip, card

    inject_civic_theme()
    hero("통합 마스터 DB", "Phase 1~7 정규화 완료 · 27 테이블", icon="🗄")
    kpi_strip([("슬롯", "161"), ("주제", "31"), ...])
"""
from __future__ import annotations

import streamlit as st


# ─────────────────────────────────────────────────────
# CSS — 한 번만 inject. session_state 로 guard.
# ─────────────────────────────────────────────────────
_CIVIC_CSS = """
<style>
/* Pretendard Variable — 프론트와 동일 */
@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css');

/* ─── design tokens (frontend globals.css 미러) ─── */
:root {
  --color-bg: #F5F7FA;
  --color-surface: #FFFFFF;
  --color-surface-muted: #EEF2F6;
  --color-border: #DBE2EA;
  --color-border-strong: #C2CCD8;
  --color-text: #0F1B2D;
  --color-text-muted: #475569;
  --color-text-subtle: #7B8794;
  --color-brand: #0B3D91;
  --color-brand-soft: #E5ECF8;
  --color-brand-strong: #08306E;
  --color-accent: #1D6FE0;

  --risk-missing: #dc2626;
  --risk-missing-soft: #fee2e2;
  --risk-missing-text: #991b1b;
  --risk-violation: #ea580c;
  --risk-violation-soft: #ffedd5;
  --risk-violation-text: #9a3412;
  --risk-warn: #facc15;
  --risk-warn-soft: #fef9c3;
  --risk-warn-text: #854d0e;
  --risk-ok: #22c55e;
  --risk-ok-soft: #d1fae5;
  --risk-ok-text: #065f46;
  --risk-skipped: #6b7280;
  --risk-skipped-soft: #f3f4f6;
  --risk-skipped-text: #374151;

  --font-sans: "Pretendard Variable", Pretendard, -apple-system, system-ui,
               "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;

  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;
  --r-pill: 999px;

  --shadow-sm: 0 1px 2px rgba(15,27,45,0.04), 0 1px 1px rgba(15,27,45,0.03);
  --shadow-md: 0 2px 8px rgba(15,27,45,0.06), 0 1px 2px rgba(15,27,45,0.04);
}

/* ─── Streamlit 전역 — body / 폰트 / 배경 ─── */
html, body, [class*="css"], .stApp {
  font-family: var(--font-sans) !important;
  color: var(--color-text);
  word-break: keep-all;
  overflow-wrap: break-word;
}
.stApp {
  background: var(--color-bg) !important;
}

/* 메인 컨텐츠 컨테이너 — Streamlit 기본 padding 줄이고 최대 폭 제한 */
.block-container {
  padding-top: 1.5rem !important;
  padding-bottom: 3rem !important;
  max-width: 1320px !important;
}

/* 기본 헤딩 마진/굵기 — 프론트와 동일 */
h1, h2, h3, h4, h5, h6 { letter-spacing: -0.3px; }
h1 { font-size: 26px !important; font-weight: 700 !important; }
h2 { font-size: 20px !important; font-weight: 700 !important; }
h3 { font-size: 17px !important; font-weight: 700 !important; }
.stCaption, [data-testid="stCaptionContainer"] {
  color: var(--color-text-subtle) !important;
  font-size: 12.5px !important;
}

/* ─── 사이드바 ─── */
[data-testid="stSidebar"] {
  background: var(--color-surface) !important;
  border-right: 1px solid var(--color-border) !important;
}
[data-testid="stSidebar"] .block-container {
  padding-top: 1.2rem !important;
}

/* ─── 탭 — 알약형, 인디케이터 ─── */
[data-baseweb="tab-list"] {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--r-lg);
  padding: 6px;
  gap: 4px !important;
  box-shadow: var(--shadow-sm);
}
[data-baseweb="tab-list"] [data-baseweb="tab"] {
  background: transparent !important;
  border-radius: var(--r-md) !important;
  font-size: 13.5px !important;
  font-weight: 600 !important;
  color: var(--color-text-muted) !important;
  padding: 8px 14px !important;
  border: none !important;
  transition: background 0.15s, color 0.15s;
}
[data-baseweb="tab-list"] [data-baseweb="tab"]:hover {
  background: var(--color-surface-muted) !important;
  color: var(--color-text) !important;
}
[data-baseweb="tab-list"] [data-baseweb="tab"][aria-selected="true"] {
  background: var(--color-brand) !important;
  color: #fff !important;
}
/* 탭 인디케이터 line 숨김 — 알약 강조로 대체 */
[data-baseweb="tab-highlight"] { display: none !important; }
[data-baseweb="tab-border"]    { display: none !important; }

/* ─── 메트릭 카드 ─── */
[data-testid="stMetric"] {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--r-lg);
  padding: 14px 16px;
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s, box-shadow 0.15s;
}
[data-testid="stMetric"]:hover {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-md);
}
[data-testid="stMetricLabel"] {
  font-size: 12px !important;
  font-weight: 600 !important;
  color: var(--color-text-subtle) !important;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
[data-testid="stMetricValue"] {
  font-size: 24px !important;
  font-weight: 700 !important;
  color: var(--color-text) !important;
  font-feature-settings: "tnum";
}
[data-testid="stMetricDelta"] {
  font-size: 11px !important;
  color: var(--color-text-subtle) !important;
}

/* ─── DataFrame ─── */
[data-testid="stDataFrame"] {
  border: 1px solid var(--color-border);
  border-radius: var(--r-lg);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  background: var(--color-surface);
}
[data-testid="stDataFrame"] thead tr th {
  background: var(--color-surface-muted) !important;
  color: var(--color-text-muted) !important;
  font-weight: 600 !important;
  font-size: 12px !important;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  border-bottom: 1px solid var(--color-border) !important;
}
[data-testid="stDataFrame"] tbody tr td {
  font-size: 13px !important;
}
[data-testid="stDataFrame"] tbody tr:hover td {
  background: var(--color-brand-soft) !important;
}

/* ─── 입력 위젯 ─── */
[data-baseweb="select"] > div,
.stTextInput input,
.stNumberInput input,
.stTextArea textarea {
  border-radius: var(--r-md) !important;
  border-color: var(--color-border) !important;
  font-size: 13.5px !important;
}
[data-baseweb="select"] > div:hover,
.stTextInput input:hover,
.stNumberInput input:hover {
  border-color: var(--color-border-strong) !important;
}

/* ─── 버튼 ─── */
.stButton > button, .stDownloadButton > button {
  border-radius: var(--r-md) !important;
  font-weight: 600 !important;
  font-size: 13.5px !important;
  border: 1px solid var(--color-border) !important;
  background: var(--color-surface) !important;
  color: var(--color-text) !important;
  transition: all 0.15s !important;
}
.stButton > button:hover, .stDownloadButton > button:hover {
  border-color: var(--color-brand) !important;
  color: var(--color-brand) !important;
  box-shadow: var(--shadow-sm);
}
.stButton > button[kind="primary"] {
  background: var(--color-brand) !important;
  border-color: var(--color-brand) !important;
  color: #fff !important;
}
.stButton > button[kind="primary"]:hover {
  background: var(--color-brand-strong) !important;
  border-color: var(--color-brand-strong) !important;
  color: #fff !important;
}

/* ─── Expander ─── */
.streamlit-expanderHeader, [data-testid="stExpander"] details summary {
  font-weight: 600 !important;
  font-size: 13.5px !important;
  border-radius: var(--r-md) !important;
}
[data-testid="stExpander"] {
  border: 1px solid var(--color-border) !important;
  border-radius: var(--r-lg) !important;
  background: var(--color-surface) !important;
  box-shadow: var(--shadow-sm) !important;
}

/* ─── 알림 (info/success/warning/error) ─── */
[data-testid="stAlert"] {
  border-radius: var(--r-md) !important;
  font-size: 13.5px !important;
}

/* ─── 디바이더 ─── */
hr {
  border-color: var(--color-border) !important;
  margin: 1.6rem 0 !important;
  opacity: 1;
}

/* ─── 코드/모노 ─── */
code, pre {
  font-family: "D2Coding","JetBrains Mono",ui-monospace,monospace !important;
  font-size: 12.5px !important;
}

/* ─── 커스텀 컴포넌트 ─── */
.civic-hero {
  background: linear-gradient(135deg, var(--color-brand) 0%, var(--color-brand-strong) 100%);
  color: #fff;
  border-radius: var(--r-lg);
  padding: 20px 26px;
  margin-bottom: 22px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: var(--shadow-md);
}
.civic-hero-icon {
  width: 48px; height: 48px;
  background: rgba(255,255,255,0.15);
  border-radius: var(--r-md);
  display: grid; place-items: center;
  font-size: 22px;
}
.civic-hero-title {
  font-size: 19px; font-weight: 700; letter-spacing: -0.3px; line-height: 1.3;
}
.civic-hero-subtitle {
  font-size: 12.5px; opacity: 0.85; margin-top: 4px;
  font-family: "D2Coding",ui-monospace,monospace;
}

.civic-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--r-lg);
  padding: 18px 20px;
  box-shadow: var(--shadow-sm);
  margin-bottom: 16px;
}
.civic-card-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px;
}
.civic-card-title {
  font-size: 14px; font-weight: 700; color: var(--color-text);
}
.civic-card-count {
  font-size: 11px; font-weight: 700;
  background: var(--color-brand-soft); color: var(--color-brand);
  padding: 3px 10px; border-radius: var(--r-pill);
}
.civic-card-caption {
  font-size: 12px; color: var(--color-text-subtle); margin-top: -4px; margin-bottom: 10px;
}

/* 위험도 chip */
.risk-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px; border-radius: var(--r-pill);
  font-size: 11px; font-weight: 700;
  border: 1px solid; line-height: 1.4;
}
.risk-chip.high    { background: var(--risk-missing-soft); color: var(--risk-missing-text);    border-color: var(--risk-missing); }
.risk-chip.mid     { background: var(--risk-warn-soft);    color: var(--risk-warn-text);       border-color: var(--risk-warn); }
.risk-chip.low     { background: var(--risk-skipped-soft); color: var(--risk-skipped-text);    border-color: var(--risk-skipped); }
.risk-chip.ok      { background: var(--risk-ok-soft);      color: var(--risk-ok-text);         border-color: var(--risk-ok); }
.risk-chip.warn    { background: var(--risk-violation-soft);color: var(--risk-violation-text); border-color: var(--risk-violation); }

/* 한 줄 통계 (key: value, key: value) */
.civic-stat-row { font-size: 12.5px; color: var(--color-text-muted); }
.civic-stat-row b { color: var(--color-text); font-weight: 700; }
.civic-stat-row .sep { color: var(--color-border-strong); margin: 0 8px; }
</style>
"""


def inject_civic_theme() -> None:
    """페이지 진입마다 호출 — 매 rerun 마다 `<style>` 태그를 다시 emit.

    이전엔 session_state guard 로 1회만 inject 했는데, Streamlit 은 페이지 전환 시
    스크립트를 처음부터 다시 실행하면서 이전 출력(`<style>` 포함) 을 비운다 →
    guard 가 설정돼 있으면 CSS 가 두 번째 페이지부터 사라지는 버그.
    """
    st.markdown(_CIVIC_CSS, unsafe_allow_html=True)


# ─────────────────────────────────────────────────────
# 컴포넌트 헬퍼
# ─────────────────────────────────────────────────────
"""커스텀 컴포넌트 — Streamlit 의 HTML sanitize 에 영향받지 않도록 모두 inline style.

Streamlit `st.markdown(unsafe_allow_html=True)` 가 `class` 속성을 보존하지 않는
케이스가 있어 (버전·렌더링 컨텍스트 따라 다름), 시각이 결정적이어야 할 컴포넌트는
class 의존을 피하고 inline style 로 작성. CSS variable 은 그대로 사용 가능 — 토큰은
:root 에 정의되어 있어 전 페이지에서 접근.
"""

# Civic 디자인 토큰 — inline style 안에서 var() 로 사용
_BG = "var(--color-bg, #F5F7FA)"
_SURFACE = "var(--color-surface, #FFFFFF)"
_BORDER = "var(--color-border, #DBE2EA)"
_BORDER_STRONG = "var(--color-border-strong, #C2CCD8)"
_TEXT = "var(--color-text, #0F1B2D)"
_TEXT_MUTED = "var(--color-text-muted, #475569)"
_TEXT_SUBTLE = "var(--color-text-subtle, #7B8794)"
_BRAND = "var(--color-brand, #0B3D91)"
_BRAND_SOFT = "var(--color-brand-soft, #E5ECF8)"
_BRAND_STRONG = "var(--color-brand-strong, #08306E)"

_SHADOW_SM = "0 1px 2px rgba(15,27,45,0.04), 0 1px 1px rgba(15,27,45,0.03)"
_SHADOW_MD = "0 2px 8px rgba(15,27,45,0.06), 0 1px 2px rgba(15,27,45,0.04)"


def hero(title: str, subtitle: str = "", icon: str = "🗄") -> None:
    """프론트 SiteHeader 와 톤 맞춘 그라데이션 hero — inline style 로 직접 작성."""
    sub_html = (
        f'<div style="font-size:12.5px;opacity:0.85;margin-top:4px;'
        f'font-family:D2Coding,ui-monospace,monospace;">{_escape(subtitle)}</div>'
        if subtitle else ""
    )
    st.markdown(
        f'<div style="background:linear-gradient(135deg,{_BRAND} 0%,{_BRAND_STRONG} 100%);'
        f'color:#fff;border-radius:14px;padding:20px 26px;margin-bottom:22px;'
        f'display:flex;align-items:center;gap:16px;box-shadow:{_SHADOW_MD};">'
        f'<div style="width:48px;height:48px;background:rgba(255,255,255,0.15);'
        f'border-radius:10px;display:grid;place-items:center;font-size:22px;flex:none;">'
        f'{icon}</div>'
        f'<div style="flex:1;min-width:0;">'
        f'<div style="font-size:19px;font-weight:700;letter-spacing:-0.3px;line-height:1.3;">'
        f'{_escape(title)}</div>'
        f'{sub_html}'
        f'</div>'
        f'</div>',
        unsafe_allow_html=True,
    )


def card_open(title: str, count: int | str | None = None, caption: str = "") -> None:
    """카드 헤더 — title + 우측 count badge + 선택 caption.

    본문 (Streamlit 위젯들) 은 카드 안에 자동으로 들어가지 않는다 — Streamlit 한계.
    헤더만 띄우고 본문 위젯은 자연스럽게 아래에 흐름. 시각적으로 헤더-내용 블록 분리.
    """
    badge_html = (
        f'<span style="font-size:11px;font-weight:700;background:{_BRAND_SOFT};'
        f'color:{_BRAND};padding:3px 10px;border-radius:999px;">{count}</span>'
        if count is not None else ""
    )
    cap_html = (
        f'<div style="font-size:12px;color:{_TEXT_SUBTLE};margin-top:4px;">'
        f'{_escape(caption)}</div>'
        if caption else ""
    )
    st.markdown(
        f'<div style="background:{_SURFACE};border:1px solid {_BORDER};'
        f'border-radius:14px;padding:16px 20px;box-shadow:{_SHADOW_SM};margin-bottom:14px;">'
        f'<div style="display:flex;align-items:center;justify-content:space-between;">'
        f'<div style="font-size:14px;font-weight:700;color:{_TEXT};">'
        f'{_escape(title)}</div>'
        f'{badge_html}'
        f'</div>'
        f'{cap_html}'
        f'</div>',
        unsafe_allow_html=True,
    )


def section_header(title: str, caption: str = "") -> None:
    """카드 없이 섹션 시작 — title 굵게 + caption 회색."""
    cap = (
        f'<div style="font-size:12px;color:{_TEXT_SUBTLE};margin-top:3px;">'
        f'{_escape(caption)}</div>'
        if caption else ""
    )
    st.markdown(
        f'<div style="margin:16px 0 8px 0;">'
        f'<div style="font-size:15px;font-weight:700;color:{_TEXT};">'
        f'{_escape(title)}</div>'
        f'{cap}'
        f'</div>',
        unsafe_allow_html=True,
    )


_RISK_PALETTE = {
    "high":  ("#fee2e2", "#991b1b", "#dc2626"),
    "warn":  ("#ffedd5", "#9a3412", "#ea580c"),
    "mid":   ("#fef9c3", "#854d0e", "#facc15"),
    "low":   ("#f3f4f6", "#374151", "#6b7280"),
    "ok":    ("#d1fae5", "#065f46", "#22c55e"),
}


def risk_chip(level: str, label: str) -> str:
    """위험도 chip HTML — inline style. dataframe 안엔 못 쓰고 st.markdown 으로만 렌더."""
    bg, fg, border = _RISK_PALETTE.get(level.lower(), _RISK_PALETTE["low"])
    return (
        f'<span style="display:inline-flex;align-items:center;gap:6px;'
        f'padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;'
        f'background:{bg};color:{fg};border:1px solid {border};line-height:1.4;">'
        f'{_escape(label)}</span>'
    )


def stat_row(*pairs: tuple[str, str]) -> None:
    """한 줄 통계 — `(라벨, 값)` 쌍 여러 개."""
    parts = []
    for label, value in pairs:
        parts.append(
            f'<span>{_escape(label)} '
            f'<b style="color:{_TEXT};font-weight:700;">{_escape(value)}</b></span>'
        )
    st.markdown(
        f'<div style="font-size:12.5px;color:{_TEXT_MUTED};">'
        + f'<span style="color:{_BORDER_STRONG};margin:0 8px;">·</span>'.join(parts)
        + '</div>',
        unsafe_allow_html=True,
    )


def _escape(s) -> str:
    if s is None:
        return ""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
