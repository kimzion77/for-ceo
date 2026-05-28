"""임금명세서 계산형 위반 룰 엔진.

설계: 임금명세서_DB모델링_설계.md 5절 — "룰 기반 + LLM 판단 하이브리드"

구현 룰 (Phase 7-B-3)
  V001 — 임금명세서 필수기재 누락 (성명·지급일·총액·구성항목·공제내역·실수령액)
  V002 — 최저임금 미달 (시급 계산: total_gross / total_work_hours)
  V010 — 공제내역 미분리 (DEDUCTION 라인이 1개뿐인데 total_deduction > 0)

추후 추가 (Phase 7-B-3b)
  V003~V006 — 가산수당·주휴수당 부족
  V007 — 임금 지급 지연
  V008 — 위법 공제

원칙
- 결정성: 같은 PayslipIn → 같은 ViolationFinding 리스트.
- 의존성 외부 데이터: minimum_wage_master · recommendation_mapping (마스터 DB).
- 룰 함수는 PayslipIn 만 받는다 — DB connection 직접 만지지 않음 (테스트 용이).
"""
from __future__ import annotations

import time
from typing import Callable

from cgr.ws import repository as repo
from cgr.ws.models import (
    InspectionResult,
    PayslipIn,
    PayslipLineIn,
    RULESET_VERSION,
    ViolationFinding,
)


# ─────────────────────────────────────────────────────
# 헬퍼
# ─────────────────────────────────────────────────────
def _payment_lines(payslip: PayslipIn) -> list[PayslipLineIn]:
    return [l for l in payslip.lines if l.line_type == "PAYMENT"]


def _deduction_lines(payslip: PayslipIn) -> list[PayslipLineIn]:
    return [l for l in payslip.lines if l.line_type == "DEDUCTION"]


def _format_won(n: int | float | None) -> str:
    if n is None:
        return "—"
    return f"{int(n):,}원"


def _render_template(template: str, **kwargs) -> str:
    """간단 변수 치환 — `{key}` → kwargs[key].

    포맷 specifier 지원: `{amount:,}` 도 동작 (str.format 기반).
    누락 키는 그대로 둠 (KeyError 안 일으킴).
    """
    try:
        return template.format(**kwargs)
    except (KeyError, ValueError, IndexError):
        # 변수 누락·잘못된 포맷 — 그대로 반환 (UI 가 fallback 처리)
        return template


def _meta(violation_code: str) -> tuple[str, str]:
    """violation_type → (name, severity). 없으면 빈 값."""
    m = repo.get_violation_meta(violation_code)
    if not m:
        return "", "MID"
    return m.get("violation_name", ""), m.get("severity", "MID") or "MID"


def _ordinary_hourly(payslip: PayslipIn) -> float | None:
    """통상시급 계산 — 통상임금 합 ÷ 총근로시간.

    가산수당 룰(V003~V005)의 공통 기준. 계산 불가 시 None.
    """
    if not payslip.total_work_hours or payslip.total_work_hours <= 0:
        return None
    ordinary_sum = 0
    for line in _payment_lines(payslip):
        if line.is_ordinary_wage_final is True:
            ordinary_sum += line.amount or 0
            continue
        if line.is_ordinary_wage_final is False:
            continue
        catalog_row = None
        if line.item_code:
            catalog_row = repo.get_wage_item_by_alias(line.item_code)
        if not catalog_row:
            catalog_row = repo.get_wage_item_by_alias(line.item_name_original)
        if catalog_row and catalog_row.get("is_ordinary_wage") == 1:
            ordinary_sum += line.amount or 0
    if ordinary_sum <= 0:
        return None
    return ordinary_sum / payslip.total_work_hours


def _amount_for_item_codes(
    payslip: PayslipIn,
    item_codes: tuple[str, ...],
) -> int:
    """주어진 item_code 들의 PAYMENT 라인 amount 합산. catalog 매칭도 시도."""
    total = 0
    for line in _payment_lines(payslip):
        # 1) 직접 item_code 일치
        if line.item_code and line.item_code in item_codes:
            total += line.amount or 0
            continue
        # 2) catalog alias 로 매칭 — '연장근로수당' 같은 원문명 → OT 같은 code
        catalog_row = repo.get_wage_item_by_alias(line.item_name_original)
        if catalog_row and catalog_row.get("item_code") in item_codes:
            total += line.amount or 0
    return total


def _is_five_plus(payslip: PayslipIn) -> bool:
    """가산수당 룰 적용 대상 사업장(5인 이상) — `근기법 §11` 적용 분기.

    `business_size = '5-'` 이면 False (가산수당 규정 적용 제외).
    None / '5+' / 그 외는 True (보수적 — 적용으로 봄).
    """
    return payslip.business_size != "5-"


# ─────────────────────────────────────────────────────
# V001 — 필수기재 누락
# ─────────────────────────────────────────────────────
def rule_v001_missing_required(payslip: PayslipIn) -> list[ViolationFinding]:
    """시행령 제27조의2 필수 기재 6개 점검.

    누락 항목 1개당 finding 1건 — 사용자가 어디를 채워야 하는지 명확.
    """
    findings: list[ViolationFinding] = []
    name, severity = _meta("V001")

    # 필수 기재 — (필드명, 표시명, 값)
    required = [
        ("worker_name", "성명", payslip.worker_name),
        ("payment_date", "임금 지급일", payslip.payment_date),
        ("total_gross", "임금 총액", payslip.total_gross),
        ("total_net", "실수령액", payslip.total_net),
    ]
    missing: list[str] = []
    for _, label, value in required:
        if value is None or (isinstance(value, str) and not value.strip()):
            missing.append(label)
    if not _payment_lines(payslip):
        missing.append("구성항목별 금액 (지급 라인)")
    if payslip.total_deduction is not None and payslip.total_deduction > 0 and not _deduction_lines(payslip):
        missing.append("공제 항목별 내역")

    if missing:
        template = repo.get_recommendation_template("V001") or "필수기재 항목을 보완하세요."
        rendered = _render_template(template, missing_fields=", ".join(missing))
        findings.append(
            ViolationFinding(
                violation_code="V001",
                violation_name=name,
                severity=severity,  # type: ignore[arg-type]
                detected_value="누락: " + ", ".join(missing),
                expected_value="6개 필수 기재 (성명·지급일·총액·실수령액·지급항목·공제내역)",
                difference_amount=0,
                detail_description=(
                    f"근로기준법 시행령 제27조의2 — {len(missing)}개 필수 기재 항목 누락."
                ),
                recommendation_text=rendered,
            )
        )
    return findings


# ─────────────────────────────────────────────────────
# V002 — 최저임금 미달
# ─────────────────────────────────────────────────────
def rule_v002_minimum_wage(payslip: PayslipIn) -> list[ViolationFinding]:
    """시급 환산 vs 연도별 최저임금.

    계산: ordinary_payment_sum / total_work_hours
    ordinary_payment_sum = PAYMENT 라인 중 통상임금 포함 항목의 합
                         (is_ordinary_wage_final 또는 catalog 기본값)
    """
    findings: list[ViolationFinding] = []
    if not payslip.total_work_hours or payslip.total_work_hours <= 0:
        return findings  # 시간 정보 없으면 판정 불가 (V001 이 잡음)

    min_wage = repo.get_minimum_wage(payslip.pay_period_year)
    if not min_wage:
        return findings
    threshold_hourly = int(min_wage["hourly_amount"])

    # 통상임금 합산
    ordinary_sum = 0
    for line in _payment_lines(payslip):
        # 1순위: 사용자/LLM 확정값
        if line.is_ordinary_wage_final is True:
            ordinary_sum += line.amount or 0
            continue
        if line.is_ordinary_wage_final is False:
            continue
        # 2순위: catalog 기본값
        catalog_row = None
        if line.item_code:
            catalog_row = repo.get_wage_item_by_alias(line.item_code)
        if not catalog_row:
            catalog_row = repo.get_wage_item_by_alias(line.item_name_original)
        if catalog_row and catalog_row.get("is_ordinary_wage") == 1:
            ordinary_sum += line.amount or 0

    if ordinary_sum <= 0:
        return findings

    actual_hourly = ordinary_sum / payslip.total_work_hours
    if actual_hourly >= threshold_hourly:
        return findings

    diff_hourly = threshold_hourly - actual_hourly
    diff_total = int(diff_hourly * payslip.total_work_hours)

    name, severity = _meta("V002")
    template = repo.get_recommendation_template("V002") or "최저임금 미달 — 차액 지급."
    rendered = _render_template(
        template,
        year=payslip.pay_period_year,
        hourly_amount=threshold_hourly,
        current_hourly=int(actual_hourly),
        diff=diff_total,
    )

    findings.append(
        ViolationFinding(
            violation_code="V002",
            violation_name=name,
            severity=severity,  # type: ignore[arg-type]
            detected_value=f"시급 {int(actual_hourly):,}원 "
                           f"(통상임금 합 {ordinary_sum:,}원 ÷ "
                           f"{payslip.total_work_hours:.1f}h)",
            expected_value=f"{payslip.pay_period_year}년 최저시급 {threshold_hourly:,}원",
            difference_amount=diff_total,
            detail_description=(
                f"통상임금 시급 환산이 최저임금에 {int(diff_hourly):,}원/h 미달. "
                f"총 {payslip.total_work_hours:.1f}h 기준 {diff_total:,}원 부족."
            ),
            recommendation_text=rendered,
        )
    )
    return findings


# ─────────────────────────────────────────────────────
# V003 — 연장근로수당 부족 (근기법 §56 ①)
# ─────────────────────────────────────────────────────
def rule_v003_overtime_short(payslip: PayslipIn) -> list[ViolationFinding]:
    """연장근로 가산 50% 부족 검사.

    기준: 통상시급 × 1.5 × overtime_hours = 예상 지급액
    실제: 명세서의 OT 항목 합산 (item_code='OT' 또는 alias '연장근로수당')
    실제 < 예상 → 위반 (차액 = 예상 - 실제)
    """
    findings: list[ViolationFinding] = []
    if not _is_five_plus(payslip):
        return findings
    if not payslip.overtime_hours or payslip.overtime_hours <= 0:
        return findings
    ordinary_hourly = _ordinary_hourly(payslip)
    if ordinary_hourly is None or ordinary_hourly <= 0:
        return findings

    expected = int(ordinary_hourly * 1.5 * payslip.overtime_hours)
    actual = _amount_for_item_codes(payslip, ("OT",))
    if actual >= expected:
        return findings  # 부족 아님
    diff = expected - actual

    name, severity = _meta("V003")
    template = repo.get_recommendation_template("V003") or "연장근로수당 차액 지급."
    rendered = _render_template(
        template,
        ot_hours=f"{payslip.overtime_hours:g}",
        ordinary_hourly=int(ordinary_hourly),
        expected=expected,
        actual=actual,
        diff=diff,
    )
    findings.append(
        ViolationFinding(
            violation_code="V003",
            violation_name=name,
            severity=severity,  # type: ignore[arg-type]
            detected_value=f"연장근로수당 {actual:,}원 (실지급)",
            expected_value=(
                f"통상시급 {int(ordinary_hourly):,}원 × 1.5 × {payslip.overtime_hours:g}h "
                f"= {expected:,}원"
            ),
            difference_amount=diff,
            detail_description=(
                f"근로기준법 제56조 제1항 — 1일 8h/1주 40h 초과 근로분에 "
                f"통상임금의 50% 가산. 차액 {diff:,}원 부족."
            ),
            recommendation_text=rendered,
        )
    )
    return findings


# ─────────────────────────────────────────────────────
# V004 — 야간근로수당 부족 (근기법 §56 ③, 22:00~06:00)
# ─────────────────────────────────────────────────────
def rule_v004_night_short(payslip: PayslipIn) -> list[ViolationFinding]:
    """야간근로 가산 50% 부족 검사.

    기준: 통상시급 × 0.5 × night_hours (가산분만)
    실제: NIGHT 항목 합산
    """
    findings: list[ViolationFinding] = []
    if not _is_five_plus(payslip):
        return findings
    if not payslip.night_hours or payslip.night_hours <= 0:
        return findings
    ordinary_hourly = _ordinary_hourly(payslip)
    if ordinary_hourly is None or ordinary_hourly <= 0:
        return findings

    expected = int(ordinary_hourly * 0.5 * payslip.night_hours)
    actual = _amount_for_item_codes(payslip, ("NIGHT",))
    if actual >= expected:
        return findings
    diff = expected - actual

    name, severity = _meta("V004")
    template = repo.get_recommendation_template("V004") or "야간근로수당 차액 지급."
    rendered = _render_template(
        template,
        night_hours=f"{payslip.night_hours:g}",
        ordinary_hourly=int(ordinary_hourly),
        diff=diff,
    )
    findings.append(
        ViolationFinding(
            violation_code="V004",
            violation_name=name,
            severity=severity,  # type: ignore[arg-type]
            detected_value=f"야간근로수당 {actual:,}원 (실지급)",
            expected_value=(
                f"통상시급 {int(ordinary_hourly):,}원 × 0.5 × {payslip.night_hours:g}h "
                f"= {expected:,}원 가산"
            ),
            difference_amount=diff,
            detail_description=(
                f"근로기준법 제56조 제3항 — 22:00~익일 06:00 근로분에 "
                f"통상임금의 50% 가산. 차액 {diff:,}원 부족."
            ),
            recommendation_text=rendered,
        )
    )
    return findings


# ─────────────────────────────────────────────────────
# V005 — 휴일근로수당 부족 (근기법 §56 ②)
# ─────────────────────────────────────────────────────
def rule_v005_holiday_short(payslip: PayslipIn) -> list[ViolationFinding]:
    """휴일근로 가산 부족 검사 — 8h 이내 50%, 8h 초과분 100%."""
    findings: list[ViolationFinding] = []
    if not _is_five_plus(payslip):
        return findings
    if not payslip.holiday_hours or payslip.holiday_hours <= 0:
        return findings
    ordinary_hourly = _ordinary_hourly(payslip)
    if ordinary_hourly is None or ordinary_hourly <= 0:
        return findings

    # 가산분 (가산률 50% / 8h 초과는 100%)
    hours = payslip.holiday_hours
    if hours <= 8:
        gain_ratio_sum = 0.5 * hours
    else:
        gain_ratio_sum = 0.5 * 8 + 1.0 * (hours - 8)
    expected = int(ordinary_hourly * gain_ratio_sum)
    actual = _amount_for_item_codes(payslip, ("HOLIDAY",))
    if actual >= expected:
        return findings
    diff = expected - actual

    name, severity = _meta("V005")
    template = repo.get_recommendation_template("V005") or "휴일근로수당 차액 지급."
    rendered = _render_template(
        template,
        holiday_hours=f"{hours:g}",
        ordinary_hourly=int(ordinary_hourly),
        diff=diff,
    )
    findings.append(
        ViolationFinding(
            violation_code="V005",
            violation_name=name,
            severity=severity,  # type: ignore[arg-type]
            detected_value=f"휴일근로수당 {actual:,}원 (실지급)",
            expected_value=(
                f"통상시급 {int(ordinary_hourly):,}원 기준 가산 {expected:,}원 "
                f"(8h 이내 50% + 초과분 100%)"
            ),
            difference_amount=diff,
            detail_description=(
                f"근로기준법 제56조 제2항 — 휴일근로 {hours:g}h 가산 부족. "
                f"차액 {diff:,}원."
            ),
            recommendation_text=rendered,
        )
    )
    return findings


# ─────────────────────────────────────────────────────
# V006 — 주휴수당 미지급 (근기법 §55 ①)
# ─────────────────────────────────────────────────────
def rule_v006_weekly_holiday_missing(payslip: PayslipIn) -> list[ViolationFinding]:
    """주 15h 이상 + 개근 → 1일 유급휴일분 임금 지급 의무.

    검사: WEEKLY_HOLIDAY 항목 라인이 있거나 amount > 0 인지.
    소정근로시간 < 15h 면 적용 제외.
    """
    findings: list[ViolationFinding] = []
    if not _is_five_plus(payslip):
        # 주휴수당은 사실 5인미만도 적용되지만 안전하게 동일 분기
        # → 후속에서 별도 룰로 분리 가능. 일단 5+ 만.
        return findings
    weekly_h = payslip.weekly_contract_hours
    if weekly_h is None:
        # 주 소정시간 모르면 추정 — total_work_hours/4.345 가 15h 이상이면 검사
        if payslip.total_work_hours:
            weekly_h = payslip.total_work_hours / 4.345
        else:
            return findings
    if weekly_h < 15:
        return findings

    actual = _amount_for_item_codes(payslip, ("WEEKLY_HOLIDAY",))
    if actual > 0:
        return findings  # 지급되어 있음 — 적정성은 별도 (추후)

    # 미지급 — 권장 금액 추정 (1일 = weekly_h/주 5일 가정)
    ordinary_hourly = _ordinary_hourly(payslip)
    estimated_diff = 0
    if ordinary_hourly:
        # 1일분 = 주 소정근로 / 5 (관례)
        daily_hours = weekly_h / 5
        # 1달 ≈ 4.345주
        estimated_diff = int(ordinary_hourly * daily_hours * 4.345)

    name, severity = _meta("V006")
    template = repo.get_recommendation_template("V006") or "주휴수당 추가 지급."
    rendered = _render_template(
        template,
        weekly_hours=f"{weekly_h:g}",
        diff=estimated_diff,
    )
    findings.append(
        ViolationFinding(
            violation_code="V006",
            violation_name=name,
            severity=severity,  # type: ignore[arg-type]
            detected_value="주휴수당 라인 없음",
            expected_value=(
                f"주 소정 {weekly_h:g}h 개근 시 유급 주휴일분 — "
                + (f"월 약 {estimated_diff:,}원" if estimated_diff else "통상시급 × 1일 소정시간 × 4.345주")
            ),
            difference_amount=estimated_diff,
            detail_description=(
                "근로기준법 제55조 제1항 — 1주 소정근로 개근 시 유급 주휴일 보장. "
                "주 15시간 이상 근로자에게 적용."
            ),
            recommendation_text=rendered,
        )
    )
    return findings


# ─────────────────────────────────────────────────────
# V007 — 임금 지급 지연 (근기법 §43 ②)
# ─────────────────────────────────────────────────────
def rule_v007_payment_late(payslip: PayslipIn) -> list[ViolationFinding]:
    """정기 지급일 도과 검사.

    엄밀한 판정은 사업장의 약정 지급일이 필요 — 현재는 시행일 도과 추정.
    `payment_date` 와 `pay_period_year/month` 의 정합성 확인:
      payment_date 가 산정기간 다음 달의 말일을 초과하면 지연으로 본다 (보수적).

    실무에선 사업장별 약정일(예: 매월 5일/10일/25일) 이 다양 — 추후 workplace 컬럼 추가 시 정밀화.
    """
    findings: list[ViolationFinding] = []
    if not payslip.payment_date or not payslip.pay_period_year:
        return findings

    import datetime as dt
    try:
        pay_dt = dt.datetime.strptime(payslip.payment_date, "%Y-%m-%d").date()
    except Exception:
        return findings

    if not payslip.pay_period_month:
        return findings

    # 산정기간 다음 달 말일을 한계로
    y, m = payslip.pay_period_year, payslip.pay_period_month
    next_m_year = y + (1 if m == 12 else 0)
    next_m = 1 if m == 12 else m + 1
    # 다음 달 말일 계산
    if next_m == 12:
        deadline = dt.date(next_m_year, 12, 31)
    else:
        first_next_next = dt.date(next_m_year, next_m + 1, 1)
        deadline = first_next_next - dt.timedelta(days=1)

    if pay_dt <= deadline:
        return findings

    days_late = (pay_dt - deadline).days

    name, severity = _meta("V007")
    template = repo.get_recommendation_template("V007") or "임금 지급 지연 해소."
    rendered = _render_template(
        template,
        pay_date_standard=deadline.isoformat(),
        days_late=days_late,
    )
    findings.append(
        ViolationFinding(
            violation_code="V007",
            violation_name=name,
            severity=severity,  # type: ignore[arg-type]
            detected_value=f"지급일 {payslip.payment_date}",
            expected_value=f"산정기간({y}-{m:02d}) 다음 달 말일까지 — {deadline.isoformat()}",
            difference_amount=0,
            detail_description=(
                f"근로기준법 제43조 제2항 — 매월 1회 이상 일정한 날에 지급. "
                f"산정기간 도과 {days_late}일."
            ),
            recommendation_text=rendered,
        )
    )
    return findings


# ─────────────────────────────────────────────────────
# V008 — 위법 공제 (근기법 §43 ①)
# ─────────────────────────────────────────────────────
# 법령·동의서 근거가 있는 일반 공제 항목 (white-list)
_LAWFUL_DEDUCTION_CODES = {
    "INCOME_TAX",          # 소득세
    "LOCAL_TAX",           # 지방소득세
    "NATIONAL_PENSION",    # 국민연금
    "HEALTH_INSURANCE",    # 건강보험
    "LONG_TERM_CARE",      # 장기요양보험
    "EMPLOYMENT_INSURANCE", # 고용보험
    "UNION_DUES",          # 단체협약 근거
}


def rule_v008_illegal_deduction(payslip: PayslipIn) -> list[ViolationFinding]:
    """동의서·법령 근거 없는 공제 탐지.

    DEDUCTION 라인 중 white-list 외 항목을 위반 후보로 표시.
    실제 동의서 유무는 사용자 확인 필요 — 결과에 [확인 필요] 메시지.
    """
    findings: list[ViolationFinding] = []
    suspicious: list[tuple[str, int]] = []
    for line in _deduction_lines(payslip):
        code = (line.item_code or "").strip()
        if code in _LAWFUL_DEDUCTION_CODES:
            continue
        # alias 로 catalog 매칭 시도
        catalog_row = repo.get_wage_item_by_alias(line.item_name_original)
        if catalog_row and catalog_row.get("item_code") in _LAWFUL_DEDUCTION_CODES:
            continue
        # 가불금·노조비 외 동의서 근거 명시 안 된 경우
        if line.amount and line.amount > 0:
            suspicious.append((line.item_name_original or "(이름 없음)", line.amount))

    if not suspicious:
        return findings

    name, severity = _meta("V008")
    template = (
        repo.get_recommendation_template("V008")
        or "동의서 없는 공제는 위법 — 사유 확인 후 환급 검토."
    )
    for item_name, amount in suspicious:
        rendered = _render_template(template, deducted_item=item_name, amount=amount)
        findings.append(
            ViolationFinding(
                violation_code="V008",
                violation_name=name,
                severity=severity,  # type: ignore[arg-type]
                detected_value=f"{item_name} {amount:,}원",
                expected_value="법령 또는 근로자 동의서 근거 필요",
                difference_amount=amount,
                detail_description=(
                    f"근로기준법 제43조 제1항 — 법령·동의서 없는 공제는 위법. "
                    f"[확인 필요] 이 항목의 공제 근거 점검."
                ),
                recommendation_text=rendered,
            )
        )
    return findings


# ─────────────────────────────────────────────────────
# V009 — 통상임금 분류 검토 (판례 쟁점 항목)
# ─────────────────────────────────────────────────────
# 통상임금 분류 쟁점 항목 — 명세서에 등장 시 사용자 확인 안내.
# 식대·정기상여·자가운전보조금은 정기·일률·고정 지급 여부에 따라 통상임금 포함이 갈림
# (대법원 2013다89399 전합 판례).
_AMBIGUOUS_ORDINARY_WAGE_CODES = {
    "MEAL",         # 식대 — 정기지급이면 통상임금 포함 판례 다수
    "BONUS_FIXED",  # 정기상여금 — 전합 판례 핵심
    "VEHICLE",      # 자가운전보조금 — 통상 미포함이 통설
    "ANNUAL_LEAVE", # 연차수당 — 통상 미포함이 통설이나 사업장 운영 따라
}


def rule_v009_ordinary_wage_check(payslip: PayslipIn) -> list[ViolationFinding]:
    """통상임금 분류 쟁점 항목 발견 시 사용자 검토 권장.

    명세서 한 달치만으로는 '정기·일률·고정 지급 여부' 단정 불가.
    catalog 기본 분류와 실제 사업장 운영이 다를 수 있어 안내성 finding 발행.

    `judgment_kind='llm'` 영역 — 실제 통상임금 포함 여부는 LLM analyze 트랙에서
    사업장 운영 실태를 묻고 `llm_judgment` 테이블에 저장 (후속 Phase).
    """
    findings: list[ViolationFinding] = []
    suspicious: list[tuple[PayslipLineIn, dict]] = []
    for line in _payment_lines(payslip):
        # 사용자가 이미 확정한 항목은 skip
        if line.is_ordinary_wage_final is not None:
            continue
        catalog_row = None
        if line.item_code:
            catalog_row = repo.get_wage_item_by_alias(line.item_code)
        if not catalog_row:
            catalog_row = repo.get_wage_item_by_alias(line.item_name_original)
        if catalog_row and catalog_row.get("item_code") in _AMBIGUOUS_ORDINARY_WAGE_CODES:
            suspicious.append((line, catalog_row))

    if not suspicious:
        return findings

    name, severity = _meta("V009")
    template = (
        repo.get_recommendation_template("V009")
        or "통상임금 분류 재검토 권장."
    )

    items_summary = ", ".join(
        f"{line.item_name_original}({line.amount:,}원)"
        for line, _ in suspicious
    )

    rendered = _render_template(
        template,
        item_name=items_summary,
    )

    findings.append(
        ViolationFinding(
            violation_code="V009",
            violation_name=name,
            severity=severity,  # type: ignore[arg-type]
            detected_value=f"쟁점 항목 {len(suspicious)}건 — {items_summary}",
            expected_value="정기·일률·고정 지급 여부 확인 → 통상임금 포함 시 가산수당 재계산",
            difference_amount=0,
            detail_description=(
                "대법원 2013다89399 전원합의체 판례 기준. 식대·정기상여 등이 "
                "매월 정해진 금액으로 모든 근로자에게 지급되면 통상임금에 포함. "
                "포함 시 V003~V005 가산수당 산정 기초가 바뀌므로 사업장 운영 실태 확인 권장."
            ),
            recommendation_text=rendered,
        )
    )
    return findings


# ─────────────────────────────────────────────────────
# V010 — 공제내역 미분리
# ─────────────────────────────────────────────────────
def rule_v010_deduction_not_separated(payslip: PayslipIn) -> list[ViolationFinding]:
    """공제 항목별 분리 의무 — total_deduction > 0 인데 DEDUCTION 라인 < 2."""
    findings: list[ViolationFinding] = []
    if not payslip.total_deduction or payslip.total_deduction <= 0:
        return findings
    dlines = _deduction_lines(payslip)
    # 일반적인 공제는 최소 4개 이상 (소득세·국민연금·건강보험·고용보험).
    # 1개 이하면 명백한 미분리.
    if len(dlines) >= 2:
        return findings

    name, severity = _meta("V010")
    template = repo.get_recommendation_template("V010") or "공제 항목 분리 기재."
    rendered = _render_template(
        template,
        it=0, np=0, hi=0, ei=0,
        total=payslip.total_deduction,
    )
    findings.append(
        ViolationFinding(
            violation_code="V010",
            violation_name=name,
            severity=severity,  # type: ignore[arg-type]
            detected_value=f"공제 라인 {len(dlines)}건 · 총액 {payslip.total_deduction:,}원",
            expected_value="공제 항목별 분리 기재 (소득세·국민연금·건강보험·고용보험 등)",
            difference_amount=0,
            detail_description=(
                "근로기준법 시행령 제27조의2 제5호 — 공제 총액만 표시되어 "
                "근로자가 항목별 공제 적정성을 확인 불가."
            ),
            recommendation_text=rendered,
        )
    )
    return findings


# ─────────────────────────────────────────────────────
# 룰셋 등록
# ─────────────────────────────────────────────────────
_RULES: list[Callable[[PayslipIn], list[ViolationFinding]]] = [
    rule_v001_missing_required,
    rule_v002_minimum_wage,
    rule_v003_overtime_short,
    rule_v004_night_short,
    rule_v005_holiday_short,
    rule_v006_weekly_holiday_missing,
    rule_v007_payment_late,
    rule_v008_illegal_deduction,
    rule_v009_ordinary_wage_check,
    rule_v010_deduction_not_separated,
]


def inspect(payslip: PayslipIn) -> InspectionResult:
    """전체 룰셋 실행.

    DB 영속화는 호출자가 별도로 (`repository.save_inspection_run`).
    """
    t0 = time.time()
    findings: list[ViolationFinding] = []
    for rule_fn in _RULES:
        try:
            findings.extend(rule_fn(payslip))
        except Exception as e:
            findings.append(
                ViolationFinding(
                    violation_code="V000",
                    violation_name=f"룰 실행 오류 ({rule_fn.__name__})",
                    severity="LOW",
                    detected_value=str(e),
                    detail_description=f"{type(e).__name__}: {e}",
                )
            )

    severity_rank = {"HIGH": 0, "MID": 1, "LOW": 2}
    findings.sort(key=lambda f: (severity_rank.get(f.severity, 9), f.violation_code))

    n_high = sum(1 for f in findings if f.severity == "HIGH")
    if n_high > 0:
        overall = "VIOLATION"
    elif findings:
        overall = "WARN"
    else:
        overall = "OK"

    return InspectionResult(
        ruleset_version=RULESET_VERSION,
        minimum_wage_year=payslip.pay_period_year,
        overall_status=overall,  # type: ignore[arg-type]
        total_violations=len(findings),
        findings=findings,
        elapsed_sec=round(time.time() - t0, 4),
    )
