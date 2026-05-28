# 취업규칙 자율점검 AI — 프로젝트 명세

> 본 문서는 프로젝트 구조 / 엔드포인트 / 데이터 흐름을 한눈에 보기 위한 운영용 명세입니다.
> 코드 변경 시 함께 갱신해 주세요.

## 1. 한 줄 소개

사업장이 자신의 **취업규칙 문서를 업로드**하면 표준취업규칙 마스터 DB · 슬롯 카탈로그 · LLM 추출 + 코드 룰 평가로 **누락 · 위반 · 주의 · 검토필요 · 적정** 5단계로 분류한 자율점검 결과를 보여주는 시스템.

## 2. 디렉토리 구조

```
3. 취업규칙/
├── backend/                                백엔드 + Streamlit 운영 앱
│   ├── cgr/                            검토 엔진 (Core Grader)
│   │   ├── api/                        FastAPI 백엔드 (port 8503)
│   │   │   ├── main.py                  진입점 (CORS, 라우터 등록, /health)
│   │   │   ├── auth.py                  X-API-Key 인증 미들웨어
│   │   │   ├── schemas.py               Pydantic 요청·응답 모델
│   │   │   └── routes/
│   │   │       ├── review.py             POST/GET 검토
│   │   │       ├── slots.py              슬롯 카탈로그 조회·편집
│   │   │       ├── master_db.py          마스터 DB 조회
│   │   │       ├── history.py            검토 이력 조회·통계
│   │   │       └── admin.py              캐시·설정·통계
│   │   ├── catalog.py                  슬롯 카탈로그 로더 (atomic_slots_v0.yaml)
│   │   ├── master_db.py                마스터 DB 로더 (취업규칙 마스터 db.xlsx)
│   │   ├── models.py                   Report / Finding / Extraction 등 도메인 모델
│   │   ├── extract.py                  LLM 슬롯 추출
│   │   ├── evaluate.py                 코드 룰 평가
│   │   ├── verdict.py                  5-Bucket 분류 (classify, overall_label)
│   │   ├── reporter.py                 사람용 리포트 마크다운 변환
│   │   ├── run.py                      review_file() — 검토 메인 파이프라인
│   │   ├── parse.py                    docx/hwp/pdf/txt → 텍스트
│   │   ├── llm_cache.py                SHA256 LLM 캐시
│   │   ├── embed_matcher.py            임베딩 기반 임의 키워드 매칭
│   │   ├── penalty_parser.py           벌칙 omission/violation 분리
│   │   ├── law_category.py             법령 대분류 (개별법/단체법/산안법/기타)
│   │   ├── topic_db.py                 토픽 메타 검색
│   │   ├── ui/                         5-Bucket / severity 상수 (BUCKET_COLORS 등)
│   │   └── web/                        Streamlit 앱 (검토 8501 / 관리자 8502)
│   │       ├── streamlit_app.py         검토 앱 진입점
│   │       ├── review_app/              검토 앱 컴포넌트 (sidebar / workplace_form / result_tabs)
│   │       └── admin/                   관리자 대시보드 (8개 페이지)
│   │           ├── admin_app.py
│   │           ├── pages/01~08_*.py
│   │           ├── data_relation/       관계 그래프·분포·빈도 통계 (5탭 분리)
│   │           └── store/               history / cache / slot_writer
│   ├── data/                           슬롯 카탈로그·검토 이력
│   │   └── slots/atomic_slots_v0.yaml
│   ├── samples/                        검토 샘플 파일 (.docx)
│   ├── output/                         과거 검토 리포트 (md, json)
│   ├── launch_streamlit.py             8501 검토 앱
│   ├── launch_admin.py                 8502 관리자
│   └── launch_api.py                   8503 FastAPI
│
├── frontend/                           Next.js 14 (App Router) — 신규 SPA
│   ├── src/
│   │   ├── app/                        라우트
│   │   │   ├── layout.tsx                루트 (metadata + viewport)
│   │   │   ├── page.tsx                  / — 홈 (문서 종류 / 업로드 / 사업장 정보)
│   │   │   └── review/[id]/
│   │   │       ├── loading/page.tsx      검토 진행 중 (4단계 progress)
│   │   │       ├── page.tsx              결과 대시보드 (Verdict / Distribution / Priority / Carousel)
│   │   │       └── findings/[findingId]/page.tsx   핀딩 상세 (4탭)
│   │   ├── components/
│   │   │   ├── ui/                       공용 UI (Icon / Button / Card / RiskBadge / Quote / Term / Donut / Toast)
│   │   │   ├── layout/SiteHeader
│   │   │   ├── home/                     Hero / DocTypePicker / FileDropzone / WorkplaceForm / workplaceHelp
│   │   │   ├── review/                   ResultHeader / VerdictCard / DistributionCard / PriorityCard /
│   │   │   │                             FilterBar / FindingCard / FindingCarousel / OptionalSection /
│   │   │   │                             LoadingScreen / verdictMessage
│   │   │   ├── review/print/             인쇄용 (PrintLayout / ReportHeader / ReportTitle / ReportVerdict /
│   │   │   │                             ReportDistribution / ReportPriorities / ReportFinding / ReportFooter)
│   │   │   └── review/detail/            Breadcrumb / CompareBox / DetailTabs / PrevNextNav
│   │   ├── data/sample.ts                mock 데이터 + pickTopPriority
│   │   ├── hooks/useMockProgress.ts      로딩 진행률 mock 훅
│   │   ├── lib/markdownBold.tsx          `**굵게**` 마커 파서
│   │   ├── styles/                       globals.css + tokens.ts
│   │   └── types/review.ts               Finding / ReviewSummary / RiskLevel
│   ├── package.json (Next 14.2 + React 18)
│   └── next.config.mjs (NEXT_PUBLIC_API_BASE → /api/* 프록시)
│
├── 취업규칙프론트엔드/                  원본 디자인 시안 (참고용)
│   ├── tokens.jsx / components.jsx
│   ├── screens-{home,loading,result,detail,meta}.jsx
│   ├── REPORT_SPEC.md                    인쇄 리포트 명세
│   └── report-redesign.jpg
│
├── 취업규칙 마스터 db (2026).xlsx        표준취업규칙 마스터 DB (Ground-truth)
├── 표준취업규칙(2026년, 배포).hwp        표준취업규칙 원본
└── docs/PROJECT.md                       본 명세
```

## 3. 5-Bucket 분류 (백엔드 → 프론트)

| 백엔드 (`cgr/verdict.py`) | 프론트 (`tokens.ts::RiskLevel`) | 한글 | 색 (BUCKET_COLORS) | 의미 |
|---|---|---|---|---|
| `누락` | `missing` | 누락 | `#dc2626` | 본문에 규정 자체가 없음 (강행) |
| `위반` | `violation` | 위반 | `#ea580c` | 본문 있으나 법정 기준 미달 (강행) |
| `주의` | `warn` | 주의 | `#facc15` | 임의 규정 미준수 |
| `검토필요` | `ambiguous` | 검토필요 | `#a855f7` | 매칭 모호 (감독관 확인 권장) |
| `적정` | `ok` | 적정 | `#22c55e` | 통과 |
| (검사 제외) | `skipped` | 선택 | `#6b7280` | 사업장 정보로 SKIP / 선택조항 |

## 4. 검토 파이프라인

```
사업장 파일 (.docx/.hwp/.pdf/.txt)
   ↓ parse_to_text
원시 텍스트
   ↓ 슬롯 카탈로그 + 마스터 DB enrich
   ↓ filter_articles_by_embedding (대상 조 후보)
   ↓ extract_slots (LLM, 슬롯별 추출값)
   ↓ evaluate (코드 룰 평가 — ≥, ≤, ==, object_match, presence, embed_match, interpret)
   ↓ is_slot_applicable (사업장 정보 SKIP)
   ↓ explain_findings (사람용 reason 생성)
   ↓ classify (5-Bucket 분류)
   ↓ finalize_report
Report (article_results[]·summary·overall_label·case_id)
   ↓ history.append_history (누적)
```

## 5. API 엔드포인트

기본 URL: `http://127.0.0.1:8503/api/v1` (개발).
모든 보호 엔드포인트는 `X-API-Key` 헤더 필요.

### 5.1 검토 (review)

| 메서드 | 경로 | 설명 | 인증 |
|---|---|---|---|
| `POST` | `/review` | 파일 업로드 + 즉시 검토 실행 (동기, 60~90초). `ReviewFullOut` 반환 | API_KEY |
| `GET` | `/review/{case_id}` | 이력에서 case_id 로 요약 조회 | API_KEY |

**POST /review** 요청 (multipart/form-data):
- `file` — 검토 대상 (.docx/.hwp/.hwpx/.pdf/.txt)
- `shift_work_used` — "true"/"false"/null
- `osha_applicable` — "true"/"false"
- `chemical_handling` — "true"/"false"/null
- `workenv_measurement` — "true"/"false"/null
- `summary_only` — true 면 finding 상세 제외

**응답 `ReviewFullOut`**:
```json
{
  "case_id": "20260429_143200_a8f2",
  "filename": "2.비스코스 취업규칙.docx",
  "overall_label": "부적정",
  "summary": {"누락":10, "위반":11, "주의":3, "검토필요":1, "적정":90},
  "n_findings": 115,
  "elapsed_sec": 78.4,
  "llm_model": "gpt-4o-mini",
  "article_results": [
    {
      "article": 24,
      "title": "연장근로",
      "findings": [
        {
          "slot_id": "WORKHOURS_OVERTIME_LIMIT",
          "article": 24,
          "bucket": "위반",
          "status": "VIOLATION",
          "severity": "HIGH",
          "comparator": "<=",
          "reason": "1주 16시간 한도가 법정 기준(12시간) 초과",
          "user_reason": "사업장 취업규칙은 1주 ...",
          "quote": "제24조(연장근로) 회사는 ...",
          "extracted_value": 16,
          "penalty_omission": [],
          "penalty_violation": ["근로기준법 제110조 — 2년 이하 ..."],
          "fix_example": "제24조(연장근로) 회사는 ... 1주 12시간을 한도로 ..."
        }
      ]
    }
  ]
}
```

### 5.2 슬롯 카탈로그 (slots)

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/slots` | 슬롯 목록 (article·comparator·severity 필터) |
| `GET` | `/slots/{slot_id}` | 단일 슬롯 상세 |
| `PUT` | `/slots/{slot_id}` | 슬롯 편집 (ADMIN_API_KEY) |

### 5.3 마스터 DB (master_db)

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/master-db/articles` | 98조 간략 목록 |
| `GET` | `/master-db/articles/{no}` | 조 상세 (본문·법령·벌칙) |

### 5.4 이력 (history)

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/history` | 검토 이력 |
| `GET` | `/history/stats` | 누적 통계 |

### 5.5 관리자 (admin)

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/admin/cache/stats` | LLM 캐시 통계 |
| `DELETE` | `/admin/cache` | 캐시 비우기 |
| `GET` | `/admin/settings` | 시스템 설정 조회 |
| `PUT` | `/admin/settings` | 시스템 설정 변경 |
| `GET` | `/admin/stats` | 전체 통계 |

### 5.6 헬스

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/health` | 헬스 체크 (인증 불요) |

## 6. 프론트 ↔ 백엔드 Finding 필드 매핑

| 프론트 (`types/review.ts::Finding`) | 백엔드 (`schemas.py::FindingOut`) | 비고 |
|---|---|---|
| `id` | — | 백엔드는 slot_id 만. 프론트는 별도 단축 ID 생성 (예: `S-014`) |
| `slotId` | `slot_id` | 1:1 |
| `article` | `article` (int) | "제24조" 형식으로 변환 |
| `articleTitle` | `ArticleResultOut.title` | 백엔드 ArticleResultOut 에서 가져옴 |
| `risk` | `bucket` (한글) | "누락"→"missing" 등 매핑 |
| `status` | `status` | 1:1 (VIOLATION/MISSING/AMBIGUOUS/OK/ERROR) |
| `title` | — (백엔드 미제공) | reason 첫 문장 또는 fix_example 1줄 추출 fallback |
| `reason` | `user_reason` 또는 `reason` | 사람용 우선 |
| `quote` | `quote` | 1:1 |
| `extracted` | `extracted_value` | 사람 친화 문자열로 변환 |
| `standard` | — (백엔드 미제공) | 추후 슬롯 메타 `master_db_ref` 또는 추출 식에서 채워야 함 |
| `laws` | — (백엔드 미제공) | penalty_omission/violation 에 법령명 함께 옴 — 별도 파싱 필요 |
| `penalty` | `penalty_omission` + `penalty_violation` | omission/violation 분리 유지 |
| `suggested` | `fix_example` | 1:1 |
| `topics` | — (백엔드 미제공) | 슬롯 카탈로그의 topic_meta 별도 조회 필요 |

> **부족한 필드 (`title`, `standard`, `laws`, `topics`)** 는 프론트 매퍼에서 fallback 으로 채우고, 백엔드 `FindingOut` 확장은 별도 작업 항목으로 분리.

## 7. 프론트엔드 라우트

| 경로 | 화면 |
|---|---|
| `/` | 홈 — 문서 종류 + 다중 파일 업로드 + 사업장 정보 |
| `/review/[id]/loading` | 검토 진행 중 — 4단계 progress |
| `/review/[id]` | 결과 대시보드 — VerdictCard / DistributionCard / PriorityCard / Carousel |
| `/review/[id]/findings/[findingId]` | 핀딩 상세 — 4탭 (시정 가이드 / 근거 법령 / 본문 위치 / 연관 주제) |

인쇄: `window.print()` → `PrintLayout` (REPORT_SPEC 명세 흑백 보고서).

## 8. 환경 변수

| 변수 | 위치 | 기본값 | 설명 |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE` | frontend `.env.local` | `http://localhost:8503` | `next.config.mjs::rewrites` 에서 `/api/*` 프록시 |
| `CGR_API_KEY` | frontend `.env.local` (server-only) | — | BFF 가 백엔드에 forward 할 때 추가하는 X-API-Key |
| `CGR_ADMIN_API_KEY` | frontend `.env.local` (server-only) | — | 관리자 엔드포인트용 |
| `OPENAI_API_KEY` | mvp `.env` | — | LLM 호출 |

## 9. 운영 포트

| 서비스 | 포트 | 실행 명령 |
|---|---|---|
| Streamlit 검토 앱 | 8501 | `python launch_streamlit.py` |
| Streamlit 관리자 | 8502 | `python launch_admin.py` |
| FastAPI 백엔드 | 8503 | `python launch_api.py` |
| Next.js 프론트 | 3000 | `cd frontend && npm run dev` |

## 10. 검토 진행 흐름 (UI 관점)

```
[홈] /
  ↓ 파일 업로드 + 사업장 정보 입력 + [검토 시작]
  ↓ POST /api/v1/review (60~90초 동기)
[로딩] /review/{caseId}/loading
  ↓ 진행률 4단계 mock 표시 (실제 백엔드 응답 대기)
  ↓ 응답 수신 → sessionStorage 저장 → router.replace
[결과] /review/{caseId}
  ↓ [상세 →]
[핀딩 상세] /review/{caseId}/findings/{findingId}
```

> **현재 mock 동작 중**. 백엔드 연동 작업 진행 중 (BFF route + 매퍼).

## 11. 향후 작업

- [ ] 백엔드 `FindingOut` 확장: `title`, `standard`, `laws`, `topics` 추가
- [ ] 대화형 자율점검 API (LLM 어댑터 패턴, 모델 교체 가능)
- [ ] 관리자 대시보드 최종 다듬기
- [ ] 다중 파일 결과 페이지 (현재 단일 검토만 지원)
- [ ] 백엔드 비동기 작업 큐 + 진행률 폴링 (현재는 동기 응답)
