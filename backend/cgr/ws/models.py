"""Phase 7 임금명세서 트랜잭션 도메인 Pydantic 모델.

설계: 임금명세서_DB모델링_설계.md
DB: schema.sql 17~27번 테이블 (workplace ~ correction_log)

설계 원칙
- 모든 PII (성명·사번·사업자번호) 는 마스킹·해시 컬럼으로만 저장.
- 사용자 입력 시점에 마스킹/해시 처리 (repository 레이어).
- 룰 엔진은 이 모델만 본다 — DB row → Pydantic → 룰 함수 의존.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ─────────────────────────────────────────────────────
# 사업장 / 근로자
# ─────────────────────────────────────────────────────
class WorkplaceIn(BaseModel):
    """사용자 입력 — 사업장 정보 (사용자가 직접 입력)."""

    business_no: str | None = Field(default=None, description="사업자번호 — 저장 시 해시됨")
    workplace_name: str | None = None
    industry_code: str | None = None
    employee_count: int | None = Field(default=None, description="상시 근로자 수")
    weekly_work_hours_std: float = 40.0
    pay_cycle_type: Literal["monthly", "weekly", "hourly", "daily"] = "monthly"


class Workplace(WorkplaceIn):
    id: int
    business_no_hashed: str | None = None
    created_at: str


class EmployeeIn(BaseModel):
    workplace_id: int
    emp_no: str | None = Field(default=None, description="사원번호 — 저장 시 해시됨")
    name: str | None = Field(default=None, description="성명 — 저장 시 마스킹됨 ('홍○○')")
    hire_date: str | None = None
    contract_type: Literal["정규직", "기간제", "단시간", "일용직"] = "정규직"
    job_position: str | None = None
    hourly_wage_agreed: int | None = None
    monthly_wage_agreed: int | None = None
    weekly_contract_hours: float | None = None


class Employee(BaseModel):
    id: int
    workplace_id: int
    emp_no_hashed: str | None
    name_masked: str | None
    hire_date: str | None
    contract_type: str
    job_position: str | None
    hourly_wage_agreed: int | None
    monthly_wage_agreed: int | None
    weekly_contract_hours: float | None
    created_at: str


# ─────────────────────────────────────────────────────
# 임금명세서 (구조화된 확정값)
# ─────────────────────────────────────────────────────
class PayslipLineIn(BaseModel):
    """임금명세서 한 줄 (지급 또는 공제)."""

    line_type: Literal["PAYMENT", "DEDUCTION"]
    item_code: str | None = Field(
        default=None, description="wage_item_catalog 코드 — None 이면 매칭 시도"
    )
    item_name_original: str = Field(
        ..., description="명세서 원문 항목명 (예: '중식보조비')"
    )
    calculation_basis: str | None = None
    unit_amount: int | None = None
    quantity: float | None = None
    amount: int = 0
    is_ordinary_wage_final: bool | None = Field(
        default=None,
        description="LLM 판단 결과. None 이면 catalog 기본값 사용",
    )


class PayslipLine(PayslipLineIn):
    id: int
    payslip_id: int
    display_order: int = 0


class PayslipIn(BaseModel):
    """사용자 확정 임금명세서 — /ws/inspect 의 입력."""

    document_id: int | None = Field(
        default=None,
        description="payslip_document FK. None 이면 trial-only (DB 저장 안 함)",
    )
    worker_name: str | None = None  # 마스킹된 상태로 받음
    worker_birth_or_emp_no: str | None = None
    total_work_days: float | None = None
    total_work_hours: float | None = None
    overtime_hours: float | None = None
    night_hours: float | None = None
    holiday_hours: float | None = None
    payment_date: str | None = None
    total_gross: int | None = None
    total_deduction: int | None = None
    total_net: int | None = None
    lines: list[PayslipLineIn] = Field(default_factory=list)

    pay_period_year: int = Field(
        ..., description="최저임금 기준이 되는 적용 연도 — 명세서 산정기간 기준"
    )
    pay_period_month: int | None = None

    # ─── 룰 분기용 컨텍스트 ───
    business_size: str | None = Field(
        default=None,
        description=(
            "사업장 규모 — '5+' / '5-' / None. "
            "V003~V005 가산수당 룰은 5인 이상만 적용 (근기법 §11)."
        ),
    )
    weekly_contract_hours: float | None = Field(
        default=None,
        description="주 소정근로시간 — V006 주휴수당 판정용 (15시간 이상 + 개근)",
    )
    pay_cycle_type: str | None = Field(
        default=None,
        description="임금 지급 주기 — monthly/weekly/hourly/daily — V007 지연 판정용",
    )


class Payslip(BaseModel):
    id: int
    document_id: int
    worker_name: str | None
    worker_birth_or_emp_no: str | None
    total_work_days: float | None
    total_work_hours: float | None
    overtime_hours: float | None
    night_hours: float | None
    holiday_hours: float | None
    payment_date: str | None
    total_gross: int | None
    total_deduction: int | None
    total_net: int | None
    is_user_confirmed: bool = False
    confirmed_at: str | None = None
    lines: list[PayslipLine] = Field(default_factory=list)


# ─────────────────────────────────────────────────────
# 룰 실행 결과
# ─────────────────────────────────────────────────────
class ViolationFinding(BaseModel):
    """룰 한 건의 결과."""

    violation_code: str  # "V002"
    violation_name: str = ""
    severity: Literal["HIGH", "MID", "LOW"] = "MID"
    payslip_line_id: int | None = None
    detected_value: str = ""
    expected_value: str = ""
    difference_amount: int = 0
    detail_description: str = ""
    status: Literal["OPEN", "FIXED", "IGNORED"] = "OPEN"
    recommendation_text: str = ""  # rendered (변수 치환 후)


class InspectionResult(BaseModel):
    """`/ws/inspect` 응답."""

    run_uid: str | None = None  # persist=True 시에만
    ruleset_version: str
    minimum_wage_year: int
    overall_status: Literal["OK", "WARN", "VIOLATION"]
    total_violations: int
    findings: list[ViolationFinding]
    elapsed_sec: float = 0.0


# ─────────────────────────────────────────────────────
# 룰셋 버전 상수 — 룰 엔진 코드 수정 시 bump.
# inspection_run.ruleset_version 컬럼에 박혀 시점 재현성 보장.
# ─────────────────────────────────────────────────────
RULESET_VERSION = "v1.0-2026-05"
