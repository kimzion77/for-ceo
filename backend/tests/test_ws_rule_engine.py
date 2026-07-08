"""임금명세서 룰엔진(V001~V010) 골든 테스트.

판정은 결정적(같은 입력 → 같은 출력)이므로, 대표 입력별 기대 판정을
그대로 고정한다 — 룰 수정 시 여기가 깨지면 ruleset_version bump 여부를 검토할 것.

기준값(최저임금·위반 메타·권장문안)은 실제 master.db 를 읽는다 —
DB 시드가 빠지면 테스트가 함께 알려준다.
"""
from __future__ import annotations

import pytest

from cgr.ws import repository as repo
from cgr.ws.models import PayslipIn, PayslipLineIn, RULESET_VERSION
from cgr.ws.services import rule_engine


# ─────────────────────────────────────────────────────
# 헬퍼 — 시나리오용 명세서 빌더
# ─────────────────────────────────────────────────────
def base_payslip(**over) -> PayslipIn:
    """모든 룰을 통과하는 '깨끗한' 명세서. over 로 시나리오 주입.

    기준시급은 master.db 의 해당 연도 최저임금 + 1,000원 — 하드코딩 없이
    기준 데이터가 바뀌어도 '깨끗함'이 유지되게.
    """
    mw = repo.get_minimum_wage(2026)
    hourly = (int(mw["hourly_amount"]) if mw else 11_000) + 1_000
    hours = 209.0
    defaults = dict(
        worker_name="홍○○",
        payment_date="2026-02-10",
        pay_period_year=2026,
        pay_period_month=1,
        total_work_hours=hours,
        total_gross=int(hourly * hours),
        total_deduction=200_000,
        total_net=int(hourly * hours) - 200_000,
        business_size="5+",
        weekly_contract_hours=40.0,
        lines=[
            PayslipLineIn(
                line_type="PAYMENT",
                item_name_original="기본급",
                amount=int(hourly * hours),
                is_ordinary_wage_final=True,
            ),
            PayslipLineIn(
                line_type="PAYMENT",
                item_code="WEEKLY_HOLIDAY",
                item_name_original="주휴수당",
                amount=1,  # 존재 여부만 보는 V006 통과용
                is_ordinary_wage_final=False,
            ),
            PayslipLineIn(
                line_type="DEDUCTION", item_code="INCOME_TAX",
                item_name_original="소득세", amount=120_000,
            ),
            PayslipLineIn(
                line_type="DEDUCTION", item_code="NATIONAL_PENSION",
                item_name_original="국민연금", amount=80_000,
            ),
        ],
    )
    defaults.update(over)
    return PayslipIn(**defaults)


def codes(payslip: PayslipIn) -> set[str]:
    return {f.violation_code for f in rule_engine.inspect(payslip).findings}


def finding(payslip: PayslipIn, code: str):
    hits = [f for f in rule_engine.inspect(payslip).findings if f.violation_code == code]
    assert hits, f"{code} finding 이 없음"
    return hits[0]


# ─────────────────────────────────────────────────────
# 기준값 존재 (ground-truth 무결성)
# ─────────────────────────────────────────────────────
def test_minimum_wage_master_seeded(master_db_available):
    mw = repo.get_minimum_wage(2026)
    assert mw is not None, "minimum_wage_master 에 2026(또는 과거) 연도 시드 필요"
    assert int(mw["hourly_amount"]) > 9_000  # 최저임금 하한 sanity


# ─────────────────────────────────────────────────────
# 깨끗한 명세서 = 위반 없음
# ─────────────────────────────────────────────────────
def test_clean_payslip_ok(master_db_available):
    result = rule_engine.inspect(base_payslip())
    # V009(통상임금 쟁점 안내)는 정보성 — 그 외 위반이 없어야 한다
    hard = {f.violation_code for f in result.findings} - {"V009"}
    assert hard == set(), f"깨끗한 명세서에서 위반 검출: {hard}"


# ─────────────────────────────────────────────────────
# V001 — 필수기재 누락
# ─────────────────────────────────────────────────────
def test_v001_missing_required(master_db_available):
    p = base_payslip(worker_name=None, payment_date=None, total_gross=None, total_net=None)
    f = finding(p, "V001")
    for label in ("성명", "임금 지급일", "임금 총액", "실수령액"):
        assert label in f.detected_value

def test_v001_no_payment_lines(master_db_available):
    p = base_payslip(lines=[])
    f = finding(p, "V001")
    assert "구성항목별 금액" in f.detected_value


# ─────────────────────────────────────────────────────
# V002 — 최저임금 미달 (기준값은 master.db 에서 동적으로)
# ─────────────────────────────────────────────────────
def test_v002_below_minimum_wage(master_db_available):
    threshold = int(repo.get_minimum_wage(2026)["hourly_amount"])
    hours = 209.0
    low = threshold - 1_000
    p = base_payslip(
        total_gross=int(low * hours),
        lines=[PayslipLineIn(
            line_type="PAYMENT", item_name_original="기본급",
            amount=int(low * hours), is_ordinary_wage_final=True,
        )],
    )
    f = finding(p, "V002")
    assert f.difference_amount == int((threshold - low) * hours)
    assert f"{threshold:,}" in f.expected_value

def test_v002_at_minimum_wage_ok(master_db_available):
    threshold = int(repo.get_minimum_wage(2026)["hourly_amount"])
    p = base_payslip(lines=[PayslipLineIn(
        line_type="PAYMENT", item_name_original="기본급",
        amount=int(threshold * 209), is_ordinary_wage_final=True,
    )])
    assert "V002" not in codes(p)

def test_v002_skipped_without_hours(master_db_available):
    assert "V002" not in codes(base_payslip(total_work_hours=None))


# ─────────────────────────────────────────────────────
# V003~V005 — 가산수당 (통상시급 10,000원 시나리오로 수식 고정)
# ─────────────────────────────────────────────────────
def _hourly_10k(**over) -> PayslipIn:
    """통상시급 정확히 10,000원 — 가산수당 계산 검증용. (최저임금 미달 V002 는 무시)"""
    hours = over.pop("total_work_hours", 209.0)
    return base_payslip(
        total_work_hours=hours,
        lines=[PayslipLineIn(
            line_type="PAYMENT", item_name_original="기본급",
            amount=int(10_000 * hours), is_ordinary_wage_final=True,
        )] + over.pop("extra_lines", []),
        **over,
    )

def test_v003_overtime_shortfall(master_db_available):
    p = _hourly_10k(
        overtime_hours=10.0,
        extra_lines=[PayslipLineIn(
            line_type="PAYMENT", item_code="OT",
            item_name_original="연장근로수당", amount=100_000,
            is_ordinary_wage_final=False,
        )],
    )
    f = finding(p, "V003")
    # 기대 = 10,000 × 1.5 × 10h = 150,000 → 부족분 50,000
    assert f.difference_amount == 50_000

def test_v003_paid_in_full_ok(master_db_available):
    p = _hourly_10k(
        overtime_hours=10.0,
        extra_lines=[PayslipLineIn(
            line_type="PAYMENT", item_code="OT",
            item_name_original="연장근로수당", amount=150_000,
            is_ordinary_wage_final=False,
        )],
    )
    assert "V003" not in codes(p)

def test_v003_exempt_under_5(master_db_available):
    """5인 미만 사업장 — 근기법 §56 가산수당 적용 제외."""
    p = _hourly_10k(overtime_hours=10.0, business_size="5-")
    assert "V003" not in codes(p)

def test_v004_night_shortfall(master_db_available):
    f = finding(_hourly_10k(night_hours=10.0), "V004")
    # 가산분만: 10,000 × 0.5 × 10h = 50,000
    assert f.difference_amount == 50_000

def test_v005_holiday_over_8h(master_db_available):
    f = finding(_hourly_10k(holiday_hours=10.0), "V005")
    # 8h까지 50% + 초과 2h 100% = 10,000 × (0.5×8 + 1.0×2) = 60,000
    assert f.difference_amount == 60_000


# ─────────────────────────────────────────────────────
# V006 — 주휴수당 미지급
# ─────────────────────────────────────────────────────
def test_v006_weekly_holiday_missing(master_db_available):
    p = _hourly_10k(weekly_contract_hours=40.0)  # WEEKLY_HOLIDAY 라인 없음
    assert "V006" in codes(p)

def test_v006_under_15h_exempt(master_db_available):
    p = _hourly_10k(weekly_contract_hours=10.0, total_work_hours=43.0)
    assert "V006" not in codes(p)


# ─────────────────────────────────────────────────────
# V007 — 임금 지급 지연 (산정기간 다음 달 말일 초과)
# ─────────────────────────────────────────────────────
def test_v007_late_payment(master_db_available):
    f = finding(base_payslip(payment_date="2026-03-05"), "V007")  # 기한 2026-02-28
    assert "2026-02-28" in f.expected_value

def test_v007_on_time_ok(master_db_available):
    assert "V007" not in codes(base_payslip(payment_date="2026-02-28"))


# ─────────────────────────────────────────────────────
# V008 — 위법 공제 (white-list 외 항목)
# ─────────────────────────────────────────────────────
def test_v008_unknown_deduction(master_db_available):
    p = base_payslip(lines=base_payslip().lines + [PayslipLineIn(
        line_type="DEDUCTION", item_name_original="임의공제테스트항목", amount=30_000,
    )])
    f = finding(p, "V008")
    assert f.difference_amount == 30_000

def test_v008_lawful_deductions_ok(master_db_available):
    assert "V008" not in codes(base_payslip())  # 소득세·국민연금만


# ─────────────────────────────────────────────────────
# V010 — 공제내역 미분리
# ─────────────────────────────────────────────────────
def test_v010_deduction_not_separated(master_db_available):
    p = base_payslip(lines=[
        l for l in base_payslip().lines if l.line_type == "PAYMENT"
    ] + [PayslipLineIn(
        line_type="DEDUCTION", item_code="INCOME_TAX",
        item_name_original="공제합계", amount=200_000,
    )])
    assert "V010" in codes(p)

def test_v010_separated_ok(master_db_available):
    assert "V010" not in codes(base_payslip())  # 공제 2줄


# ─────────────────────────────────────────────────────
# 집계·결정성
# ─────────────────────────────────────────────────────
def test_inspect_deterministic(master_db_available):
    """같은 입력 → 완전히 같은 판정 (elapsed 제외). 시스템 최상위 요건."""
    p = base_payslip(payment_date="2026-03-05", worker_name=None)
    r1 = rule_engine.inspect(p).model_dump(exclude={"elapsed_sec"})
    r2 = rule_engine.inspect(p).model_dump(exclude={"elapsed_sec"})
    assert r1 == r2

def test_inspect_severity_sorted(master_db_available):
    result = rule_engine.inspect(base_payslip(worker_name=None, payment_date="2026-03-05"))
    rank = {"HIGH": 0, "MID": 1, "LOW": 2}
    ranks = [rank[f.severity] for f in result.findings]
    assert ranks == sorted(ranks), "findings 는 severity 순 정렬이어야 함"

def test_inspect_overall_status_ok(master_db_available):
    result = rule_engine.inspect(base_payslip())
    assert result.overall_status in ("OK", "WARN")  # V009 정보성만 있으면 WARN 허용
    assert result.ruleset_version == RULESET_VERSION

def test_ruleset_version_pinned():
    """룰 수정 시 버전 bump 를 잊지 않도록 버전 문자열 자체를 고정."""
    assert RULESET_VERSION == "v1.0-2026-05"
