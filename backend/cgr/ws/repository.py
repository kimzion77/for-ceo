"""Phase 7 임금명세서 트랜잭션 도메인 — 마스터 DB 영속화 helper.

설계 원칙
- PII 는 입력 시점에 마스킹·해시. 해시 함수는 SHA-256 (저장 충돌·복호화 불가).
- 모든 함수는 `with db.connect() as conn` 컨텍스트에서 실행 — 자동 commit/rollback.
- 룰 엔진 영속화는 `save_inspection_run()` 한 번에 run + findings + recommendations 모두.
"""
from __future__ import annotations

import hashlib
import json
import secrets
from typing import Any

from cgr import db as _db

from .models import (
    EmployeeIn,
    InspectionResult,
    PayslipIn,
    PayslipLineIn,
    ViolationFinding,
    WorkplaceIn,
)


# ─────────────────────────────────────────────────────
# PII 마스킹·해시
# ─────────────────────────────────────────────────────
def hash_pii(value: str | None) -> str | None:
    """사업자번호·사번 등 식별자 → SHA-256 hex.

    None 또는 빈 문자열이면 None 반환 — DB UNIQUE 위반 방지.
    """
    if not value:
        return None
    norm = "".join(c for c in str(value) if c.isalnum())
    if not norm:
        return None
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


def mask_name(name: str | None) -> str | None:
    """'홍길동' → '홍○○'. 한 글자면 그대로."""
    if not name:
        return None
    name = name.strip()
    if len(name) <= 1:
        return name
    return name[0] + "○" * (len(name) - 1)


def _gen_uid(prefix: str) -> str:
    """run_uid·doc_uid 등 외부 노출용 짧은 식별자."""
    return f"{prefix}_{secrets.token_urlsafe(8)}"


# ─────────────────────────────────────────────────────
# Upsert helpers
# ─────────────────────────────────────────────────────
def upsert_workplace(wp: WorkplaceIn) -> int:
    """사업자번호 해시 기준 upsert. id 반환."""
    bn_hash = hash_pii(wp.business_no)
    with _db.connect() as conn:
        if bn_hash:
            cur = conn.execute(
                "SELECT id FROM workplace WHERE business_no_hashed = ?",
                (bn_hash,),
            )
            row = cur.fetchone()
            if row:
                conn.execute(
                    "UPDATE workplace SET "
                    "  workplace_name = ?, industry_code = ?, "
                    "  employee_count = ?, weekly_work_hours_std = ?, "
                    "  pay_cycle_type = ? "
                    "WHERE id = ?",
                    (
                        wp.workplace_name,
                        wp.industry_code,
                        wp.employee_count,
                        wp.weekly_work_hours_std,
                        wp.pay_cycle_type,
                        row["id"],
                    ),
                )
                return row["id"]
        cur = conn.execute(
            "INSERT INTO workplace "
            "(business_no_hashed, workplace_name, industry_code, "
            " employee_count, weekly_work_hours_std, pay_cycle_type) "
            "VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
            (
                bn_hash,
                wp.workplace_name,
                wp.industry_code,
                wp.employee_count,
                wp.weekly_work_hours_std,
                wp.pay_cycle_type,
            ),
        )
        return cur.fetchone()["id"]


def upsert_employee(emp: EmployeeIn) -> int:
    """workplace_id + 사번 해시 기준 upsert. id 반환."""
    emp_hash = hash_pii(emp.emp_no)
    name_masked = mask_name(emp.name)
    with _db.connect() as conn:
        if emp_hash:
            cur = conn.execute(
                "SELECT id FROM employee "
                "WHERE workplace_id = ? AND emp_no_hashed = ?",
                (emp.workplace_id, emp_hash),
            )
            row = cur.fetchone()
            if row:
                conn.execute(
                    "UPDATE employee SET "
                    "  name_masked = ?, hire_date = ?, contract_type = ?, "
                    "  job_position = ?, hourly_wage_agreed = ?, "
                    "  monthly_wage_agreed = ?, weekly_contract_hours = ? "
                    "WHERE id = ?",
                    (
                        name_masked,
                        emp.hire_date,
                        emp.contract_type,
                        emp.job_position,
                        emp.hourly_wage_agreed,
                        emp.monthly_wage_agreed,
                        emp.weekly_contract_hours,
                        row["id"],
                    ),
                )
                return row["id"]
        cur = conn.execute(
            "INSERT INTO employee "
            "(workplace_id, emp_no_hashed, name_masked, hire_date, "
            " contract_type, job_position, hourly_wage_agreed, "
            " monthly_wage_agreed, weekly_contract_hours) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
            (
                emp.workplace_id,
                emp_hash,
                name_masked,
                emp.hire_date,
                emp.contract_type,
                emp.job_position,
                emp.hourly_wage_agreed,
                emp.monthly_wage_agreed,
                emp.weekly_contract_hours,
            ),
        )
        return cur.fetchone()["id"]


# ─────────────────────────────────────────────────────
# 임금명세서 문서 + 확정값 + 라인
# ─────────────────────────────────────────────────────
def create_payslip_document(
    *,
    workplace_id: int | None = None,
    employee_id: int | None = None,
    pay_period_year: int | None = None,
    pay_period_month: int | None = None,
    original_file_path: str | None = None,
    uploaded_by: str | None = None,
) -> tuple[int, str]:
    """문서 1건 생성. (id, doc_uid) 반환."""
    doc_uid = _gen_uid("DOC")
    with _db.connect() as conn:
        cur = conn.execute(
            "INSERT INTO payslip_document "
            "(doc_uid, workplace_id, employee_id, "
            " pay_period_year, pay_period_month, "
            " original_file_path, uploaded_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
            (
                doc_uid,
                workplace_id,
                employee_id,
                pay_period_year,
                pay_period_month,
                original_file_path,
                uploaded_by,
            ),
        )
        return cur.fetchone()["id"], doc_uid


def save_payslip(payslip: PayslipIn) -> int:
    """확정 임금명세서 저장 (payslip + payslip_line). payslip.id 반환.

    document_id 가 None 이면 trial-only 라 ValueError.
    """
    if not payslip.document_id:
        raise ValueError("save_payslip: payslip.document_id 가 필요합니다.")
    with _db.connect() as conn:
        cur = conn.execute(
            "INSERT INTO payslip "
            "(document_id, worker_name, worker_birth_or_emp_no, "
            " total_work_days, total_work_hours, "
            " overtime_hours, night_hours, holiday_hours, "
            " payment_date, total_gross, total_deduction, total_net, "
            " is_user_confirmed, confirmed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now')) "
            "ON CONFLICT(document_id) DO UPDATE SET "
            "  worker_name = excluded.worker_name, "
            "  total_gross = excluded.total_gross, "
            "  is_user_confirmed = 1 "
            "RETURNING id",
            (
                payslip.document_id,
                mask_name(payslip.worker_name),
                payslip.worker_birth_or_emp_no,  # 이미 마스킹 가정
                payslip.total_work_days,
                payslip.total_work_hours,
                payslip.overtime_hours,
                payslip.night_hours,
                payslip.holiday_hours,
                payslip.payment_date,
                payslip.total_gross,
                payslip.total_deduction,
                payslip.total_net,
            ),
        )
        payslip_id = cur.fetchone()["id"]
        # 기존 라인 삭제 후 재삽입 — UPSERT 단순화
        conn.execute("DELETE FROM payslip_line WHERE payslip_id = ?", (payslip_id,))
        for order, line in enumerate(payslip.lines):
            conn.execute(
                "INSERT INTO payslip_line "
                "(payslip_id, line_type, item_code, item_name_original, "
                " calculation_basis, unit_amount, quantity, amount, "
                " is_ordinary_wage_final, display_order) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    payslip_id,
                    line.line_type,
                    line.item_code,
                    line.item_name_original,
                    line.calculation_basis,
                    line.unit_amount,
                    line.quantity,
                    line.amount,
                    1 if line.is_ordinary_wage_final
                    else (0 if line.is_ordinary_wage_final is False else None),
                    order,
                ),
            )
        return payslip_id


# ─────────────────────────────────────────────────────
# 룰 실행 결과 영속화
# ─────────────────────────────────────────────────────
def save_inspection_run(
    payslip_id: int,
    result: InspectionResult,
) -> tuple[int, str]:
    """룰엔진 실행 결과 → inspection_run + violation_finding + recommendation.

    (run_id, run_uid) 반환.
    """
    run_uid = _gen_uid("RUN")
    with _db.connect() as conn:
        cur = conn.execute(
            "INSERT INTO inspection_run "
            "(run_uid, payslip_id, ruleset_version, minimum_wage_year, "
            " total_violations, overall_status) "
            "VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
            (
                run_uid,
                payslip_id,
                result.ruleset_version,
                result.minimum_wage_year,
                result.total_violations,
                result.overall_status,
            ),
        )
        run_id = cur.fetchone()["id"]
        for f in result.findings:
            cur = conn.execute(
                "INSERT INTO violation_finding "
                "(run_id, violation_code, payslip_line_id, "
                " detected_value, expected_value, difference_amount, "
                " detail_description, status) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
                (
                    run_id,
                    f.violation_code,
                    f.payslip_line_id,
                    f.detected_value,
                    f.expected_value,
                    f.difference_amount,
                    f.detail_description,
                    f.status,
                ),
            )
            finding_id = cur.fetchone()["id"]
            if f.recommendation_text:
                conn.execute(
                    "INSERT INTO recommendation "
                    "(finding_id, rendered_text, suggested_amount) "
                    "VALUES (?, ?, ?)",
                    (finding_id, f.recommendation_text, f.difference_amount or None),
                )
        return run_id, run_uid


# ─────────────────────────────────────────────────────
# 조회 helpers
# ─────────────────────────────────────────────────────
def get_minimum_wage(year: int) -> dict[str, Any] | None:
    """연도별 최저임금. 없으면 가장 가까운 과거 연도 fallback."""
    with _db.connect() as conn:
        cur = conn.execute(
            "SELECT * FROM minimum_wage_master WHERE year = ?", (year,)
        )
        row = cur.fetchone()
        if row:
            return dict(row)
        # fallback — 가장 가까운 과거 연도
        cur = conn.execute(
            "SELECT * FROM minimum_wage_master "
            "WHERE year < ? ORDER BY year DESC LIMIT 1",
            (year,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_recommendation_template(violation_code: str) -> str | None:
    """위반 → 권고 본문 템플릿 (priority 가장 낮은 = 우선)."""
    with _db.connect() as conn:
        cur = conn.execute(
            "SELECT recommendation_text FROM recommendation_mapping "
            "WHERE violation_code = ? ORDER BY priority LIMIT 1",
            (violation_code,),
        )
        row = cur.fetchone()
        return row["recommendation_text"] if row else None


def get_violation_meta(violation_code: str) -> dict[str, Any] | None:
    """violation_type 한 건."""
    with _db.connect() as conn:
        cur = conn.execute(
            "SELECT * FROM violation_type WHERE violation_code = ?",
            (violation_code,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def get_wage_item_by_alias(alias: str) -> dict[str, Any] | None:
    """사업장별 이형 항목명(예: '중식보조비') → wage_item_catalog 행 매칭.

    1) item_name 정확 일치
    2) aliases JSON 배열 안에 포함
    """
    if not alias:
        return None
    with _db.connect() as conn:
        cur = conn.execute(
            "SELECT * FROM wage_item_catalog WHERE item_name = ?", (alias,)
        )
        row = cur.fetchone()
        if row:
            return dict(row)
        # aliases JSON 검색
        cur = conn.execute("SELECT * FROM wage_item_catalog WHERE aliases IS NOT NULL")
        for r in cur.fetchall():
            try:
                arr = json.loads(r["aliases"] or "[]")
            except Exception:
                arr = []
            if alias in arr:
                return dict(r)
    return None
