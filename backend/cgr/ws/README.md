# `cgr.ws` — 임금명세서 모듈 (Phase 5~7)

근로기준법 제48조 + 시행령 제27조의2 기반.
11 슬롯 (성명·지급일·총액·구성항목·공제내역 등) + 계산형 룰엔진.

## 핵심 차별점 (vs EC)

| 측면 | EC | WS |
|---|---|---|
| 슬롯 수 | 35 | 11 |
| 카테고리 분기 | 33-매핑 (공통/5+/기간제/...) | 단일 그룹 (worker_types=any 대부분) |
| 카탈로그 소스 | SQL + YAML fallback | **SQL only** |
| 분석 트랙 | LLM 단일 | **LLM 판단형 + 룰엔진 계산형 하이브리드** |
| 컨텍스트 입력 | business_size, worker_types | + pay_period_year/month, contract_type, pay_cycle, weekly_hours |

## 룰엔진 (Phase 7-B-3)

`services/rule_engine.py` — 결정성 보장:
- **V001 필수기재 누락** — 성명·지급일·총액·라인 검사
- **V002 최저임금 미달** — 통상임금합 ÷ 근로시간 vs `minimum_wage_master`
- **V010 공제내역 미분리** — DEDUCTION 라인 수 검사

후속:
- V003~V006 가산수당·주휴수당 (통상시급·소정시간 필요)
- V007 임금 지급 지연
- V008 위법 공제
- V009 통상임금 분류 (LLM 트랙)

## 파일

| 파일 | 책임 |
|---|---|
| `catalog.py` | 11 슬롯 로더 (DB 전용) |
| `models.py` | Pydantic — Workplace/Employee/Payslip/PayslipLine/ViolationFinding/InspectionResult |
| `repository.py` | 영속화 — SHA-256 hash·마스킹·upsert·save_inspection_run |
| `services/analyze.py` | LLM 11 슬롯 분석 + 최저임금 자동 주입 |
| `services/rule_engine.py` | 계산형 룰 V001/V002/V010 + 확장 가능 구조 |
| `services/generate.py` | 시정안 반영된 표준 명세서 본문 |

## 진입

```python
from cgr.ws.models import PayslipIn, PayslipLineIn
from cgr.ws.services.rule_engine import inspect
from cgr.ws.services import analyze, generate

# 1) LLM 분석 (텍스트 입력)
result = analyze.run(
    wage_text,
    business_size='5-',
    worker_types=['정규직'],
    pay_period_year=2025,
    pay_period_month=4,
    contract_type='정규직',
    pay_cycle='월급',
)

# 2) 룰엔진 (구조화 입력)
payslip = PayslipIn(
    pay_period_year=2025,
    total_work_hours=209,
    total_gross=1_985_500,
    lines=[
        PayslipLineIn(line_type='PAYMENT', item_code='BASIC', item_name_original='기본급', amount=1_985_500),
        # ...
    ],
)
result = inspect(payslip)
# → InspectionResult { overall_status, findings[V002 차액 110,770원], ... }

# 3) 표준 본문 생성
wage_text = generate.run(analysis_result, original_wage_text, user_overrides={})
```

## API

`backend/cgr/api/routes/ws.py` — 4 엔드포인트:
- `POST /api/v1/ws/extract` — 파일 → 텍스트
- `POST /api/v1/ws/analyze` — 텍스트 → LLM 분석
- `POST /api/v1/ws/inspect` — 구조화 payslip → 계산형 룰엔진 (persist 옵션)
- `POST /api/v1/ws/generate` — 분석 결과 → 표준 본문
- `GET  /api/v1/ws/catalog` — 11 슬롯 카탈로그 (관리자)

## PII

`repository.hash_pii()` / `mask_name()` 진입.
- 사업자번호·사원번호 → SHA-256
- 성명 → `홍길동` → `홍○○`
