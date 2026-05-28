# 📚 영세사업장 자율점검 서비스 — 문서 인덱스

> 노동법 자율점검 서비스의 설계·구현·운영 종합 문서.
> 검토 대상: **취업규칙 · 근로계약서 · 임금명세서** 3 문서.

---

## 🗂 문서 목록

### 시스템 이해

| 문서 | 내용 | 대상 독자 |
|---|---|---|
| [`01_시스템_개요.md`](01_시스템_개요.md) | 서비스 전체상, 3-tier 아키텍처, 핵심 결정 사항 | 모두 |
| [`02_데이터_파이프라인.md`](02_데이터_파이프라인.md) | 문서 업로드→OCR→분석→권고 단계별 흐름 (mermaid) | 개발자·기획자 |
| [`03_데이터_흐름도.md`](03_데이터_흐름도.md) | 시스템 컴포넌트 간 데이터 이동 + PII 비식별화 경계 | 보안·개발자 |
| [`04_자료사전.md`](04_자료사전.md) | 27 테이블 + 2 뷰의 모든 컬럼·관계·제약 | DB·BE 개발자 |
| [`05_모듈_가이드.md`](05_모듈_가이드.md) | `cgr.*` Python 패키지 책임·의존성 | BE 개발자 |
| [`06_개발_가이드.md`](06_개발_가이드.md) | 로컬 실행·재시드·배포·트러블슈팅 | 개발자·운영자 |

### 기존 자료 (참고용 · 일부 outdated 가능)

| 문서 | 비고 |
|---|---|
| [`PROJECT.md`](PROJECT.md) | 초기 프로젝트 개요 |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | RFP 기준 초기 아키텍처 (Phase 5~7 미반영) |
| [`RFP_ALIGNMENT.md`](RFP_ALIGNMENT.md) | RFP 요건 매핑 |
| [`REQUIREMENTS_MATRIX.md`](REQUIREMENTS_MATRIX.md) | 요건 매트릭스 |
| `references/` | 정책·법령·디자인 참고자료 |

---

## 🚀 빠른 시작

```bash
# 1) 백엔드 — FastAPI (port 8503)
cd backend && python launch_api.py

# 2) 관리자 — Streamlit (port 8502)
cd backend && python launch_admin.py

# 3) 프론트엔드 — Next.js (port 3000)
cd frontend && npm run dev
```

상세는 [`06_개발_가이드.md`](06_개발_가이드.md).

---

## 🏗 시스템 구조 한눈에

```
┌─────────────────┐
│  사용자 (사업주)  │
└────────┬────────┘
         │ 1) 문서 업로드 (취업규칙·근로계약서·임금명세서)
         ▼
┌─────────────────────────────────┐       ┌──────────────────┐
│  Next.js Frontend (port 3000)    │◄─────│  관리자 Streamlit │
│  • 문서 종류·사업장 정보 입력      │      │  (port 8502)     │
│  • 검토 결과 (게이지·캐러셀·권고)  │      │  • 마스터 DB 시각화 │
│  • 표준 문서 생성                │      │  • 검토 이력      │
└────────┬────────────────────────┘       │  • 슬롯 편집     │
         │ /api/cgr/* (BFF)               └──────────────────┘
         ▼                                          │
┌─────────────────────────────────┐                 │
│  FastAPI Backend (port 8503)     │◄────────────────┘
│  • /api/v1/ec/*  근로계약서       │                 read-only
│  • /api/v1/ws/*  임금명세서       │
│  • /api/v1/review/* 취업규칙      │
│  • /api/v1/topics/corpus 코퍼스   │
└────────┬────────────────────────┘
         │
         ├──► OpenAI-호환 LLM (Dauri SAMI GPT) — 비식별 데이터만
         │
         └──► SQLite 마스터 DB (master.db)
              • 27 테이블 + 2 뷰
              • 슬롯·법령·주제 reference
              • 임금명세서 계산형 룰 (V001~V010)
              • 트랜잭션 (workplace·employee·payslip·inspection_run)
```

---

## 📂 폴더 구조 (현재)

```
3. 취업규칙/
├── docs/                       # 본 문서 (당신이 보고 있는 곳)
├── frontend/                   # Next.js 프론트엔드
│   └── src/
│       ├── app/                # Next.js App Router
│       │   ├── page.tsx        # 홈 (문서 선택·업로드)
│       │   ├── review/[id]/
│       │   │   ├── ec/         # 근로계약서 결과
│       │   │   └── ws/         # 임금명세서 결과
│       │   └── api/cgr/        # BFF 프록시 (서버측 X-API-Key)
│       ├── components/
│       └── lib/api/            # API 클라이언트 (ec.ts, ws.ts, topics.ts)
│
├── backend/                        # Python 백엔드 + 관리자
│   ├── cgr/                    # 메인 패키지
│   │   ├── api/                # FastAPI (routes/, auth, schemas)
│   │   ├── db/                 # SQLite 마스터 DB (schema.sql)
│   │   ├── ec/                 # 근로계약서 모듈 (catalog, prompts, services)
│   │   ├── ws/                 # 임금명세서 모듈 (catalog, models, repository, rule_engine)
│   │   ├── parsers/            # OCR · 파일 파서
│   │   ├── web/admin/          # Streamlit 관리자 페이지
│   │   └── …                   # 취업규칙(workrules) 공용 — catalog, rules, embedding 등
│   ├── data/
│   │   ├── master.db           # 통합 마스터 DB (SQLite)
│   │   ├── slots/              # 슬롯 YAML 카탈로그
│   │   └── topic_corpus.json   # 노무사회 31주제 1779섹션
│   ├── scripts/
│   │   ├── seed_master_db.py   # 마스터 DB 시드 (전체)
│   │   └── seed_wage_masters.py# Phase 6 룰 마스터
│   └── launch_*.py             # API · 관리자 · 검토앱 런처
│
├── knowledge/                  # 노무사회 obsidian 자산 (입력)
└── 1. 근로계약서/              # 원본 자료 디렉토리
```

---

## 🗓 개발 히스토리 — Phase 별 산출물

| Phase | 산출물 | 상태 |
|---|---|---|
| 1~3 | 통합 마스터 DB (`master.db`) · 12 테이블 · 슬롯/주제/법령 정규화 | ✅ |
| 4 | 프론트 코퍼스 lazy fetch (`/topics/corpus`) | ✅ |
| 5 | 임금명세서 모듈 (11 슬롯 · `/ws/*` API) | ✅ |
| 6 | 계산형 룰 마스터 (최저임금·임금항목·V001~V010·권고매핑) | ✅ |
| 7-Back | 트랜잭션 모델 (workplace·employee·payslip·inspection_run 등 11 테이블) + 룰엔진 | ✅ |
| 7-Front | 임금명세서 결과 페이지 EC 동일 디자인 (게이지·캐러셀·SuggestBlock) | ✅ |
| A | 관리자 대시보드 파이프라인 시각화 | ✅ |

총 27 테이블 + 2 뷰. [`04_자료사전.md`](04_자료사전.md) 참조.
