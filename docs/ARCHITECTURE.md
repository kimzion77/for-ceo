# 아키텍처 — 온프레미스 + 외부 LLM 데이터 흐름

> RFP의 가장 중요한 원칙: **개인정보 포함 데이터는 온프레미스, 외부 LLM 은 비식별 데이터만**

---

## 1. 전체 데이터 흐름도 (목표 아키텍처)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            사용자 (영세 사업주)                                │
│                            익명 · 무로그인 · 세션 기반                           │
└──────────────────┬───────────────────────────────────────────────────────────┘
                   │ (1) 문서/사진 업로드
                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        프론트엔드 (Next.js 14)                                  │
│                                                                              │
│  • 홈 (문서종류 + 다중 파일 + 사업장 정보)                                       │
│  • 로딩 (진행률 표시)                                                          │
│  • 결과 대시보드 (5-Bucket carousel)                                          │
│  • 핀딩 상세 (4탭)                                                            │
│  • 인쇄 리포트 (REPORT_SPEC 흑백)                                             │
│  • 챗봇 인터페이스 (대화형 자율점검) ← 미구현                                   │
│  • 산재 사진 업로드 ← 미구현                                                   │
└──────────────────┬───────────────────────────────────────────────────────────┘
                   │ /api/cgr/* (BFF)
                   │ X-API-Key 헤더 서버측 주입
                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│              BFF (Next.js API Route — server-only)                            │
│                                                                              │
│  • CGR_API_KEY 환경변수 → X-API-Key 헤더                                       │
│  • multipart/form-data 재구성 (boundary 문제 해결)                            │
│  • runtime: nodejs, maxDuration: 120                                          │
└──────────────────┬───────────────────────────────────────────────────────────┘
                   │ POST /api/v1/review
                   │ X-API-Key
                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                  Backend API 서버 (FastAPI, 포트 8503)                          │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  ① 문서 처리 파이프라인                                                  │    │
│  │     parsers/ → docx/hwp/hwpx/pdf/plain                               │    │
│  │     (OCR/VLM 파싱 ← 미구현 — AMR-001 후 추가)                          │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  ② 개인정보 검출·비식별화 (← 미구현, SFR-003)                            │    │
│  │     • 정규식 (주민번호, 연락처, 계좌번호)                                 │    │
│  │     • NER (이름, 주소)                                                 │    │
│  │     • 온프레미스 LLM 보조                                                │    │
│  │     • 2차 검증 필터 (외부 LLM 전송 전 의무)                             │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  ③ 위반 탐지 엔진 (cgr/run.py + slot catalog)                          │    │
│  │     • 슬롯 추출 (extract)                                              │    │
│  │     • 코드 룰 평가 (evaluate)                                          │    │
│  │     • 5-Bucket 분류 (verdict)                                          │    │
│  │     • 벌칙 분류 (penalty_parser: omission/violation)                  │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  ④ 로직계산기 (← 미구현, SFR-002)                                       │    │
│  │     • 최저임금 계산                                                     │    │
│  │     • 퇴직금 계산                                                       │    │
│  │     • 연장근로수당 계산                                                  │    │
│  │     • 사용자 인자값 검증 단계 거침                                       │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  ⑤ 매핑 엔진 (위반 → 표준 권고안)                                       │    │
│  │     • 슬롯 카탈로그 fix_example                                         │    │
│  │     • 마스터 DB 표준 본문                                                │    │
│  │     • 매핑 정확도 99% 목표 (QUR-001)                                    │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  ⑥ LLM 어댑터 (← 미구현, SIR-001)                                       │    │
│  │     • 온프레미스 LLM ↔ 외부 상용 LLM 추상화                              │    │
│  │     • 모델 교체 가능 (특정 API 종속 X)                                   │    │
│  │     • 프롬프트 인젝션·탈옥 가드레일                                       │    │
│  │     • 토큰 사용량·비용 추적                                              │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────┬───────────────────────────────────────────────────────────┘
                   │
        ┌──────────┼──────────────────────────────┐
        │          │                              │
        ▼          ▼                              ▼
┌──────────────────────────────┐  ┌───────────────────────────────────┐
│  온프레미스 GPU (대구센터 H100)  │  │     외부 상용 LLM API              │
│                              │  │                                   │
│  • VLM OCR 파인튜닝 모델 (AMR) │  │  • 법적 판단 (비계산적)            │
│  • 개인정보 검출 LLM           │  │  • 산재 사진 분석                  │
│  • 가드레일 LLM                │  │                                   │
│                              │  │  ← 비식별 텍스트 / 사진(개인정보 X) │
│  ← 개인정보 포함 원본 처리     │  │                                   │
└──────────────────────────────┘  └───────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         데이터 저장소                                            │
│                                                                              │
│  • 마스터 DB: 취업규칙 (98조) / 근로계약서 / 임금명세서 (정규화 시트)            │
│  • 슬롯 카탈로그: atomic_slots_v0_<doc>.yaml                                  │
│  • 검토 이력: 누적 통계 (개인정보 비포함)                                       │
│  • LLM 캐시: SHA256 키 기반 (재현성 확보)                                      │
│  • 학습 데이터: 비식별화 OCR 결과 (학습 완료 후 삭제)                           │
│                                                                              │
│  ✗ 업로드 원본은 분석 완료 즉시 삭제 (SER-001)                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 현재 시스템 (실제 구현, 취업규칙 MVP)

```
┌───────────────────────┐
│   브라우저 (사용자)        │
└───────────┬───────────┘
            │ http://localhost:3000
            ▼
┌───────────────────────┐       ┌──────────────────────────┐
│  Next.js Frontend      │ BFF→ │ Next.js API Route         │
│  (localhost:3000)      │      │ /api/cgr/[...path]        │
│                        │      │  • CGR_API_KEY 주입         │
│  · 홈 (다중 파일+사업장정보)│      │  • multipart 재구성        │
│  · 로딩 (mock progress)│      └──────────┬───────────────┘
│  · 결과 (carousel)      │                 │ X-API-Key
│  · 상세 (4탭)           │                 ▼
│  · PDF 인쇄 (REPORT)    │      ┌──────────────────────────┐
└───────────────────────┘      │ FastAPI Backend          │
                                │ (localhost:8503)         │
                                │                          │
                                │ POST /api/v1/review      │
                                │  · 파일 + 사업장 정보 수신   │
                                │  · review_file() 실행     │
                                │  · 5-Bucket 결과 반환      │
                                │                          │
                                │ GET /api/v1/review/{id}  │
                                │  · 이력 조회               │
                                └──────────┬───────────────┘
                                           │
                              ┌────────────┼────────────┐
                              │            │            │
                              ▼            ▼            ▼
                       ┌───────────┐ ┌──────────┐ ┌──────────┐
                       │ 슬롯 카탈로그│ │ 마스터 DB │ │ OpenAI API│
                       │ YAML      │ │ Excel    │ │ (현재 직접) │
                       │ 115개      │ │ 98조      │ │           │
                       └───────────┘ └──────────┘ └──────────┘
                                                      ↑
                                       어댑터화 후 교체 가능 구조로 (SIR-001)
```

### 차이점 (현재 ↔ 목표)

| 항목 | 현재 | 목표 |
|---|---|---|
| 문서 종류 | 취업규칙만 | 근로계약서·임금명세서·취업규칙 |
| OCR | 없음 (텍스트 파일만) | VLM OCR (HWP/PDF/JPG/PNG) |
| 개인정보 처리 | 없음 (취업규칙은 개인정보 비포함) | 검출·제거·2차 검증 게이트웨이 |
| LLM 호출 | OpenAI 직접 (`cgr/extract.py`) | 어댑터 패턴 + 온프레미스 우선 |
| 가드레일 | 없음 | 프롬프트 인젝션·탈옥 방어 |
| 산재 점검 | 없음 | 사진 업로드 + 위험등급 |
| 챗봇 | 없음 | 대화형 자율점검 |

---

## 3. 컴포넌트 책임 분담

### 프론트엔드 (`frontend/`)

| 경로 | 책임 |
|---|---|
| `src/app/page.tsx` | 홈 — 문서 종류 선택, 다중 파일 업로드, 사업장 정보 |
| `src/app/review/[id]/loading/` | 진행률 표시 (현재 mock, 백엔드 폴링으로 교체 예정) |
| `src/app/review/[id]/` | 결과 대시보드 (종합판정 + 분포 + carousel) |
| `src/app/review/[id]/findings/[findingId]/` | 핀딩 상세 (Breadcrumb + 4탭 + 이전/다음) |
| `src/app/api/cgr/[...path]/route.ts` | BFF (서버측 API 키 주입, multipart 재구성) |
| `src/components/ui/` | 디자인 시스템 (Icon, Button, Card, RiskBadge, Donut 등) |
| `src/components/review/print/` | 인쇄 리포트 (REPORT_SPEC 흑백 명세) |
| `src/lib/api/` | fetch 클라이언트 + 백엔드 ↔ 프론트 매퍼 |
| `src/styles/tokens.ts` + `globals.css` | 디자인 토큰 (5-Bucket) |
| `src/types/review.ts` | TypeScript 타입 (Finding, ReviewSummary, RiskLevel) |

### 백엔드 (`backend/cgr/`)

| 경로 | 책임 |
|---|---|
| `api/main.py` | FastAPI 진입점 (포트 8503), CORS 설정 |
| `api/routes/review.py` | POST `/api/v1/review` 검토 실행 + GET `/{case_id}` 조회 |
| `api/routes/slots.py` | GET 슬롯 카탈로그, PUT 편집 (관리자) |
| `api/routes/master_db.py` | GET 마스터 DB 조 본문 |
| `api/routes/history.py` | GET 검토 이력·통계 |
| `api/routes/admin.py` | 캐시·설정 관리 |
| `api/schemas.py` | Pydantic 응답 모델 |
| `api/auth.py` | X-API-Key 검증 |
| `run.py` | 검토 엔진 — extract → evaluate → finalize |
| `extract.py` | LLM 슬롯 추출 (OpenAI 직접, 어댑터화 필요) |
| `evaluate.py` | 코드 룰 평가 (=, >=, <=, embed_match, interpret) |
| `verdict.py` | 5-Bucket 분류 (누락/위반/주의/검토필요/적정) |
| `explainer.py` | LLM 사유 생성 |
| `penalty_parser.py` | 벌칙 분류 (omission / violation) |
| `master_db.py` | 표준취업규칙 DB 로더 |
| `catalog.py` | 슬롯 카탈로그 로드 + master DB 연결 |
| `parsers/` | docx / hwp / hwpx / pdf / plain |
| `llm_cache.py` | SHA256 캐시 (재현성 확보) |
| `embed_matcher.py` | 임베딩 기반 매칭 (OpenAI text-embedding) |
| `ui/` | 5-Bucket 상수 + Streamlit 카드 헬퍼 |
| `web/streamlit_app.py` | Streamlit 검토 UI (포트 8501) |
| `web/admin/admin_app.py` | Streamlit 관리자 UI (포트 8502) |

### 신규 추가 예정 (RFP 갭)

| 영역 | 신규 모듈 |
|---|---|
| OCR | `cgr/ocr/vlm_adapter.py`, `cgr/ocr/preprocess.py` |
| 개인정보 | `cgr/privacy/detector.py`, `cgr/privacy/gateway.py`, `cgr/privacy/lifecycle.py` |
| LLM 어댑터 | `cgr/llm/adapter.py`, `cgr/llm/providers/{onprem,openai,anthropic}.py`, `cgr/llm/guardrail.py` |
| 로직계산기 | `cgr/calc/min_wage.py`, `cgr/calc/severance.py`, `cgr/calc/overtime.py` |
| 챗봇 | `cgr/chat/session.py`, `cgr/chat/validator.py`, `frontend/src/app/chat/` |
| 산재 | `cgr/safety/risk_classifier.py`, `frontend/src/app/safety/` |

---

## 4. 데이터 흐름 — 검토 1건 시 (현재)

```
1. 사용자가 홈에서 .docx 파일 선택 + 사업장 정보 입력 → "검토 시작"
   └→ frontend POST /api/cgr/review (multipart)

2. BFF 가 X-API-Key 주입 + 백엔드로 forward
   └→ POST http://127.0.0.1:8503/api/v1/review

3. 백엔드:
   ① 임시 파일 저장 (.docx)
   ② parsers/dispatcher.py → parse_to_text()
   ③ extract_slots() — LLM 호출 (OpenAI)
      • 캐시 hit 시 LLM 호출 생략 (재현성)
   ④ filter_articles_by_embedding() — pre-filter
   ⑤ is_slot_applicable() — 사업장 정보로 SKIP 판단
   ⑥ evaluate() — 코드 룰 평가
   ⑦ explain_findings() — LLM 사유 생성
   ⑧ finalize_report() — 5-Bucket 카운트, verdict
   ⑨ history.append_history() — 이력 누적
   ⑩ tmp 파일 삭제

4. 응답: ReviewFullOut (case_id + summary + article_results)
   └→ BFF → 프론트

5. 프론트:
   • mappers.ts → backend FindingOut → frontend Finding
   • sessionStorage 에 저장 + /review/{caseId} 로 라우팅
   • 결과 페이지가 sessionStorage 읽고 표시
```

---

## 5. 보안 경계

| 경계 | 통제 |
|---|---|
| 브라우저 ↔ Next.js | HTTPS (운영), CORS, CSP |
| Next.js ↔ FastAPI | X-API-Key (BFF 가 server-only env 주입) |
| 백엔드 ↔ 온프레미스 LLM | 내부망 (대구센터) |
| 백엔드 ↔ 외부 상용 LLM | **2차 검증 필터** (개인정보 잔존 여부) |
| 데이터 저장소 ↔ 학습 | 비식별 데이터만 보존, 학습 완료 후 삭제 |

---

## 6. 가용성 / 운영 토폴로지 (목표)

```
[로드밸런서] → [Next.js × N] → [FastAPI × N] → [온프레미스 LLM (대구센터)]
                                               ↘ [외부 LLM API (rate-limited)]
                                               ↘ [PostgreSQL · 검토 이력]
                                               ↘ [Redis · LLM 캐시 + 세션]
                                               ↘ [Object Storage · 임시 업로드]
```

> 현재 MVP 는 localhost 단일 노드. 운영 시 위 토폴로지로 확장.
