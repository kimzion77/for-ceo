"""API 요청·응답 Pydantic 스키마.

내부 cgr.models 의 Report/Finding 을 그대로 노출하지 않고 API 친화적 형태로 가공.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ─── 공통 ────────────────────────────────────
class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "1.0.0"
    services: dict[str, str] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    detail: str


# ─── 검토 ────────────────────────────────────
class WorkplaceContextIn(BaseModel):
    """사업장 정보 입력 (검토 시 슬롯 SKIP 판단용)."""

    shift_work_used: bool | None = Field(default=None, description="교대근로 도입 여부 (None=모름)")
    osha_applicable: bool | None = Field(default=True, description="산업안전보건법 적용 업종")
    chemical_handling: bool | None = Field(default=None, description="화학물질 취급")
    workenv_measurement: bool | None = Field(default=None, description="작업환경측정 대상")


class FindingOut(BaseModel):
    slot_id: str
    article: int
    bucket: str  # 누락/위반/주의/검토필요/적정
    status: str  # OK/VIOLATION/MISSING/AMBIGUOUS/ERROR
    severity: str
    comparator: str
    reason: str
    user_reason: str | None = None
    quote: str = ""
    extracted_value: Any = None
    penalty_omission: list[str] = Field(default_factory=list)
    penalty_violation: list[str] = Field(default_factory=list)
    fix_example: str | None = None


class ArticleResultOut(BaseModel):
    article: int
    title: str
    findings: list[FindingOut]


class ReviewSummaryOut(BaseModel):
    """검토 결과 요약."""

    case_id: str
    filename: str
    overall_label: str  # 적정/부적정/검토불가
    summary: dict[str, int]  # 5-bucket 카운트
    n_findings: int
    elapsed_sec: float
    llm_model: str = ""


class ReviewFullOut(ReviewSummaryOut):
    """검토 전체 결과 (상세 finding 포함)."""

    article_results: list[ArticleResultOut]


# ─── 슬롯 ────────────────────────────────────
class SlotOut(BaseModel):
    slot_id: str
    article: int
    parent_clause: str | None = None
    required: bool
    comparator: str
    violation_severity: str | None = None
    missing_severity: str | None = None
    extract_target: str | None = None
    search_phrases: list[str] = Field(default_factory=list)
    threshold_ok: float | None = None
    threshold_violation: float | None = None
    fix_example: str | None = None
    penalty: list[str] = Field(default_factory=list)
    topic_meta: list[str] = Field(default_factory=list)


class SlotListOut(BaseModel):
    total: int
    slots: list[SlotOut]


class SlotUpdateIn(BaseModel):
    """슬롯 편집 입력. 변경할 필드만 전송 (PATCH 스타일)."""

    search_phrases: list[str] | None = None
    threshold_ok: float | None = None
    threshold_violation: float | None = None
    violation_severity: str | None = None
    missing_severity: str | None = None
    extract_target: str | None = None
    fix_example: str | None = None


class SlotUpdateOut(BaseModel):
    slot_id: str
    saved: bool
    backup_dir: str
    message: str = ""


# ─── 마스터 DB ───────────────────────────────
class ArticleOut(BaseModel):
    no: int
    title: str
    scope: str = ""
    body: str = ""
    guide: str = ""
    note: str = ""
    law: str = ""
    topic: str = ""
    penalty: str = ""
    penalty_omission: list[str] = Field(default_factory=list)
    penalty_violation: list[str] = Field(default_factory=list)
    amend_new: str = ""
    amend_old: str = ""
    freq_issue: str = ""


class ArticleListOut(BaseModel):
    total: int
    db_path: str
    articles: list[dict[str, Any]]  # 간략 목록 (no, title, scope, slot_count)


# ─── 이력 ────────────────────────────────────
class HistoryEntryOut(BaseModel):
    ts: str
    case_id: str
    filename: str
    overall_label: str = ""
    llm_model: str = ""
    by_bucket: dict[str, int] = Field(default_factory=dict)
    top_violations: list[str] = Field(default_factory=list)


class HistoryListOut(BaseModel):
    total: int
    entries: list[HistoryEntryOut]


class HistoryStatsOut(BaseModel):
    n_total: int
    n_recent_30d: int = 0
    avg_violation: float = 0.0
    avg_missing: float = 0.0
    top_slots: list[tuple[str, int]] = Field(default_factory=list)


# ─── 캐시 ────────────────────────────────────
class CacheStatsOut(BaseModel):
    entries: int
    size_kb: int


class CacheClearOut(BaseModel):
    deleted: int


# ─── 설정 ────────────────────────────────────
class SettingsOut(BaseModel):
    embed_threshold_ok: float
    embed_threshold_violation: float
    prefilter_threshold: float
    llm_model: str
    embed_model: str
    master_db_version: str
    default_workplace: dict[str, Any]


class SettingsUpdateIn(BaseModel):
    embed_threshold_ok: float | None = None
    embed_threshold_violation: float | None = None
    prefilter_threshold: float | None = None
    llm_model: str | None = None
    embed_model: str | None = None
    master_db_version: str | None = None
    default_workplace: dict[str, Any] | None = None


# ─── 통계 ────────────────────────────────────
class StatsOut(BaseModel):
    n_slots: int
    comparator_dist: dict[str, int]
    severity_dist: dict[str, int]
    n_articles: int
    n_reviews: int
    n_cache: int


# ─── 근로계약서 (EC) ─────────────────────────
class EcFindingOut(BaseModel):
    """근로계약서 검토 결과 1건 — 3-Bucket 분류 (적절/보완필요/부적절)."""

    slot_id: str
    field: str
    bucket: str  # 적절 / 보완필요 / 부적절
    severity: str  # CRITICAL/HIGH/MEDIUM/LOW
    present: bool
    extracted: str = ""
    reason: str = ""
    required_content: str = ""
    purpose: str = ""
    laws: list[str] = Field(default_factory=list)
    topic_meta: list[str] = Field(default_factory=list)
    fix_example: str = ""


class EcReviewOut(BaseModel):
    """근로계약서 검토 응답."""

    case_id: str
    filename: str
    doc: str = "employment_contract"
    overall_label: str  # 적절 / 보완필요 / 부적절 / 검토불가
    summary: dict[str, int]  # 3-Bucket 카운트
    n_findings: int
    skipped: int = 0
    elapsed_sec: float
    findings: list[EcFindingOut] = Field(default_factory=list)
