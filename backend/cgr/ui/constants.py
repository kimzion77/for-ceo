"""5-Bucket 분류·severity·comparator UI 상수.

기존 매핑이 다음 5곳에 흩어진 것을 통합:
  - cgr/reporter.py            : _BUCKET_EMOJI
  - cgr/web/streamlit_app.py   : metric help 텍스트·탭 라벨
  - cgr/web/admin/pages/02_*.py: stacked bar 색
  - cgr/web/admin/pages/08_*.py: bar chart 색
  - cgr/web/admin/admin_app.py : 종합 KPI 라벨

수정 시 이 파일 한 곳만 변경. 호출자는 from cgr.ui import ... 로 사용.
"""
from __future__ import annotations


# ─── 5-Bucket (verdict.classify 출력) ───────
BUCKET_ORDER = ["누락", "위반", "주의", "검토필요", "적정"]

BUCKET_EMOJI: dict[str, str] = {
    "누락": "🔴",
    "위반": "🟠",
    "주의": "🟡",
    "검토필요": "🟣",
    "적정": "✅",
    "검토불가": "⚠️",
}

BUCKET_COLORS: dict[str, str] = {
    "누락": "#dc2626",
    "위반": "#ea580c",
    "주의": "#facc15",
    "검토필요": "#a855f7",
    "적정": "#22c55e",
}

# 메트릭 카드용 짧은 도움말 (호버 ?)
BUCKET_HELP: dict[str, str] = {
    "누락": (
        "**🔴 누락** — 본문에 규정 자체가 없음\n\n"
        "- 강행규정인데 본문에서 관련 규정을 찾지 못함\n"
        "- **시정 필수** · 과태료·벌금 가능\n"
        "- 예: 임금명세서 교부의무 미기재, 교대근로 운영형태 미기재"
    ),
    "위반": (
        "**🟠 위반** — 본문에 있으나 법정 기준 미달/구법 잔존\n\n"
        "- 강행규정인데 수치가 모자라거나 옛 법령 표현이 남아 있음\n"
        "- **시정 필수** · 과태료·벌금·징역 가능\n"
        "- 예: 배우자 출산휴가 10일(법정 20일), 연소자 1주 6시간(법정 5시간)"
    ),
    "주의": (
        "**🟡 주의** — 임의·권고 수준의 미준수\n\n"
        "- 직접 적용 벌칙이 없는 임의 사항·확인적 규정\n"
        "- **시정 권장** · 강제성 없음\n"
        "- 예: 회계연도 기준 연차 부여, 휴일 전일 임금지급"
    ),
    "검토필요": (
        "**🟣 검토필요** — 매칭이 모호함\n\n"
        "- 본문 표현이 기준과 비슷하나 명확히 일치하지 않음\n"
        "- **감독관이 본문을 직접 확인 권장**\n"
        "- 코사인 유사도 0.48~0.50 범위"
    ),
    "적정": (
        "**✅ 적정** — 본문 매칭·기준 충족\n\n"
        "- 본문에 관련 규정이 명시되어 있고 법정 기준 충족\n"
        "- 또는 임의 규정 미기재 (해당사항 없음)\n"
        "- 추가 시정 불필요"
    ),
}


# ─── Severity ───────────────────────────────
SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]

SEVERITY_COLOR: dict[str, str] = {
    "CRITICAL": "#dc2626",  # 진빨강 — 형사처벌
    "HIGH":     "#ea580c",  # 주황 — 과태료
    "MEDIUM":   "#facc15",  # 노랑 — 표현 불명확
    "LOW":      "#22c55e",  # 초록 — 권고
    "INFO":     "#94a3b8",  # 회색 — OK
}


# ─── 종합 판정 라벨 (verdict.overall_label) ──
OVERALL_EMOJI: dict[str, str] = {
    "적정": "🟢",
    "부적정": "🔴",
    "검토불가": "🟡",
}


# ─── comparator 라벨 (사용자 친화 한국어) ───
COMPARATOR_LABEL: dict[str, str] = {
    ">=":           "이상 (수치)",
    "<=":           "이하 (수치)",
    "==":           "정확 일치",
    "object_match": "객체 일치 (다중 키)",
    "presence":     "존재 여부",
    "embed_match":  "임베딩 매칭 (LLM 미사용)",
    "interpret":    "LLM 해석",
}
