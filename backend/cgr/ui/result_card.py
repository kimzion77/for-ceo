"""슬롯 결과 카드 — 공통 데이터 준비 헬퍼.

reporter.py(마크다운 리포트)와 streamlit_app.py(웹 UI)가
같은 finding 을 다른 매체로 렌더할 때 공유.

직접 Streamlit 호출은 하지 않는다 — 데이터만 가공하고 호출 측이 표시.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from cgr.models import Finding
from cgr.penalty_parser import format_for_user
from cgr.verdict import classify


@dataclass
class SlotCardData:
    """슬롯 카드를 그리는 데 필요한 모든 데이터.

    Streamlit·Markdown·API 응답에서 공유. 추가 가공 없이 바로 매체별 렌더.
    """
    slot_id: str
    article: int
    bucket: str               # 누락/위반/주의/검토필요/적정
    status: str               # OK/VIOLATION/MISSING/AMBIGUOUS/ERROR
    severity: str
    comparator: str
    reason: str               # user_reason 또는 reason fallback
    raw_reason: str           # 코드 룰의 기술 사유
    quote: str
    has_quote: bool
    extracted_value: Any
    expected_value: Any
    penalty_omission: list[str] = field(default_factory=list)
    penalty_violation: list[str] = field(default_factory=list)
    penalty_no_penalty: bool = False
    fix_example: str | None = None


def build_card_data(f: Finding) -> SlotCardData:
    """Finding → SlotCardData. 벌칙 자동 분류·bucket·quote 정리 포함."""
    bucket = classify(f)
    user_reason = (f.user_reason or "").strip()
    code_reason = (f.reason or "").strip()
    quote = (f.extracted.quote if f.extracted else "") or ""

    parts = format_for_user(f.penalty or [])
    no_penalty = (
        not parts["omission"]
        and not parts["violation"]
        and bool(f.penalty)
    )

    return SlotCardData(
        slot_id=f.slot_id,
        article=f.article,
        bucket=bucket,
        status=f.status,
        severity=f.severity or "",
        comparator=f.comparator or "",
        reason=user_reason or code_reason,
        raw_reason=code_reason,
        quote=quote,
        has_quote=bool(quote),
        extracted_value=(f.extracted.extracted_value if f.extracted else None),
        expected_value=(f.expected.value if f.expected else None),
        penalty_omission=parts["omission"],
        penalty_violation=parts["violation"],
        penalty_no_penalty=no_penalty,
        fix_example=f.fix_example,
    )


def adapt_reason_for_bucket(card: SlotCardData) -> str:
    """버킷에 맞는 사유 텍스트 반환.

    적정 탭에서는 LLM 의 부정문 사유가 부적정처럼 보이는 사고를 막기 위해
    단순화된 문구로 대체.
    """
    if card.bucket != "적정":
        return card.reason
    # 적정 탭 단순화
    master_v = card.expected_value
    if master_v is False:
        return "본문에 부적정 표현(구법 잔존 등)이 없어 적정합니다."
    if card.has_quote:
        return "본문에 관련 규정이 명시되어 있습니다."
    return "임의 규정 — 본문 미기재 가능 (해당사항 없음)."
