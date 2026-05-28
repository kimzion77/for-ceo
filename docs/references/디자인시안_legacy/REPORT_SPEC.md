# 결과 리포트 화면 — 구현 명세서 (Claude Code 지시용)

## 1. 화면 개요

**파일명**: `app/review/[id]/page.tsx` (Next.js App Router) 또는 `pages/review/[id].tsx`
**용도**: 취업규칙 자율점검 결과 — **PDF 보관 / 흑백 인쇄 친화** 보고서
**대상**: 비전공 영세 사업주(5~30인) — 5분 내 핵심 파악
**디자인 토큰**: 흑백 + 종이톤 한 가지(`#F5F4EF`). 컬러 사용 금지(흑백 인쇄 대응).

## 2. 데이터 계약 (TypeScript)

```ts
type RiskKind = "missing" | "violation" | "caution" | "review" | "ok";

interface ReportSummary {
  fileName: string;
  fileSize: string;          // "84.4KB"
  reviewedAt: string;        // "2026-04-29 14:32"
  duration: string;          // "1분 18초"
  reportId: string;          // "RV-2026-04-29-A8F2"
  verdict: "적정" | "부적정" | "부적정 중대";
  totalSlots: number;        // 검사 항목 총합
  excluded: number;          // 선택조항 제외 건수
  counts: Record<RiskKind, number>;
  priorities: Array<{ n: number; kind: RiskKind; article: string; title: string; findingId: string; }>;
}

interface Finding {
  no: number;
  kind: RiskKind;
  article: string;           // "제45조"
  articleTitle: string;      // "출산전후휴가"
  title: string;             // 한 줄 요약
  reason: string;            // 평이한 한국어 설명
  extracted: string;         // 본문에서 발견된 표현 (짧게)
  standard: string;          // 법정 기준 (짧게)
  quote: string;             // 본문 인용 (원문)
  suggested: string;         // 시정안 (그대로 복사용)
  law: { name: string; text: string };
  penalty?: string;          // 미기재 시 벌칙
}
```

## 3. 디자인 토큰

```ts
export const REPORT_TOKENS = {
  ink: "#0A0A0A",
  ink2: "#1F2937",
  gray1: "#525252",  // 보조 텍스트
  gray2: "#8A8A8A",  // 캡션
  gray3: "#C9C9C9",  // 가는 구분선
  gray4: "#E5E5E5",  // 더 가는 구분선
  paper: "#FFFFFF",
  tint:  "#F5F4EF",  // 인용/배경 (인쇄 시 회색)
  pageBg: "#E8E6E0",
};

// 위험도 — 색이 아닌 채움 패턴으로 식별
export const RISK = {
  missing:   { label: "누락",     tier: "강" },  // 솔리드 채움
  violation: { label: "위반",     tier: "강" },  // 굵은 사선
  caution:   { label: "주의",     tier: "중" },  // 가는 사선
  review:    { label: "검토필요", tier: "중" },  // 가로 줄무늬
  ok:        { label: "적정",     tier: "약" },  // 빈칸
};
```

## 4. 화면 구성 (위에서 아래로)

### 4.1 머리(Header) — 부처 보고서 톤
- 좌: `노동법 자율점검 · WORK RULES REVIEW` (letter-spacing 3, 11px, 회색)
- 좌 하단: `고용노동부 표준취업규칙 DB 기반 검토 결과` (13px)
- 우: `REPORT-ID · {reportId}`, `발급 · {reviewedAt}`, `1 / 8` — 모노스페이스 11px
- 구분: **3중 검정선**(`border-bottom: 3px double #0A0A0A`)

### 4.2 표제
- H1 36px, 800, letter-spacing -1: "취업규칙 자율점검 결과"
- 메타 4행: 검토 파일 / 검토 일시 / 소요 시간 / 검사 항목 — `grid-template-columns: 100px 1fr`, 라벨은 gray1, 값은 ink. 숫자는 모노스페이스.

### 4.3 종합 판정 박스
- **2px 검정 외곽선**, 좌측에 종합 판정 라벨 + 큰 활자("부적정" 44px, 800)
- 영문 보조: "NON-COMPLIANT" (11px, gray1, 모노)
- 우측: 강행규정 미준수 N건 / 누락·위반·주의·검토필요 카운트 한 줄

### 4.4 §01 검사항목 분포
- **가로 스택드 바** (높이 28px, 검정 1px 외곽선) — 5단계가 패턴으로 식별됨
- 범례: 패턴 스와치(16×12) + 라벨 + 건수
- **표 형식 분포표** — 컬럼: 구분(패턴) / 분류 / 건수(우측정렬) / 비중(우측정렬) / 막대바
  - 상단 2px 검정선, 하단 1px 검정선, 행간 1px 회색선
  - 헤더 uppercase 11px

### 4.5 §02 가장 먼저 시정해야 할 항목
- 단순 ol 리스트 (3건)
- 각 행: `01` `02` `03` (26px 모노, 800) + 위험도 라벨 + 조항(모노) + 제목(16px 700) + "상세 보기 →"
- 행 사이 1px 회색선, 상하 1px 검정선

### 4.6 §03 지적사항 상세
**상세 핀딩 본체** — 다음 흐름:

1. **헤더**: `02` 검정 채움 사각형 + 위험도 라벨 + 조항·조항명
2. **제목**: H3 24px 800, 하단 1px 회색선 + 16px 패딩
3. **왜 이게 문제인가요?** — `FieldLabel` + 본문 14.5px line-height 1.8
4. **본문 vs 법정 기준** — 2행 표
   - 1행: "본문 표현" / 본문에서 발견된 짧은 표현 (`text-decoration: line-through`, 색은 회색)
   - 2행: "법정 기준" / 법정 기준 (굵게)
   - 표 외곽선 1px 검정, 라벨 셀 배경 `tint`
5. **사업장 본문 인용** — `<blockquote>` 좌 4px 검정 보더, 배경 `tint`, 모노스페이스
6. **이렇게 고쳐 보세요** — `FieldLabel emphasis` (마커 더 길게)
   - 2px 검정 외곽선 박스 + 모노스페이스 본문 + 우상단 검정 "복 사" 버튼
7. **근거 법령** — 1px 회색 외곽선 박스, 법령명 + 점선 구분 + 본문
8. **벌칙** — 1px 검정 외곽선, 좌측 `PENALTY` 텍스트 배지 + 본문

`FieldLabel` 컴포넌트: 11px 800 uppercase letter-spacing 1, 좌측에 10px(emphasis 시 18px) × 2px 검정 마커 (작은 인디케이터 바)

### 4.7 페이지네이션
- 좌: "← 이전 지적사항" (외곽선 버튼)
- 중: `02 / 25` 모노
- 우: "다음 지적사항 →" (검정 채움 버튼)

### 4.8 푸터
- 상단 2px 검정선
- 좌: 안내문 ("본 리포트는 자율점검 참고용입니다. 시정 시에는 근로기준법 제94조에 따른 근로자 의견청취(과반수 동의) 절차가 필요합니다.")
- 우: REPORT-ID, "p. 1 / 8" (모노)

## 5. 위험도 패턴 (핵심)

흑백 인쇄에서 식별 가능해야 함. **컬러 의존 절대 금지**.

```ts
function patternForKind(k: RiskKind) {
  switch (k) {
    case "missing":   return { background: "#0A0A0A" };
    case "violation": return { background: "repeating-linear-gradient(45deg, #0A0A0A 0, #0A0A0A 3px, white 3px, white 6px)" };
    case "caution":   return { background: "repeating-linear-gradient(45deg, #525252 0, #525252 1.5px, white 1.5px, white 5px)" };
    case "review":    return { background: "repeating-linear-gradient(0deg, #525252 0, #525252 1px, white 1px, white 4px)" };
    case "ok":        return { background: "white" };
  }
}
```

위험도 마크(`RiskMark`) — 본문 라벨에 사용:
- 강(missing/violation): `■` 검정 채움 사각형
- 중(caution/review): `▣` 2px 외곽선
- 약(ok): `□` 1px 회색 외곽선

## 6. 타이포 / 간격 규칙

- 본문 폰트: Pretendard Variable
- 모노스페이스: `D2Coding`, 폴백 `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
- 본문 종이 폭: `max-width: 880px`
- 종이 좌우 패딩: `56px`
- 섹션 사이: `36px`
- 섹션 내부 블록 사이: `24px`
- 모든 숫자: `font-variant-numeric: tabular-nums`

## 7. 인쇄 CSS (필수)

```css
@media print {
  body { background: white; }
  .paper { box-shadow: none; max-width: none; }
  .no-print { display: none; }
  /* 페이지 분할 — 핀딩 단위로 끊기 */
  .finding { break-inside: avoid; }
  /* 컬러 보존 (인쇄 시 패턴 유지) */
  * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}
@page { size: A4; margin: 18mm 16mm; }
```

## 8. 상호작용

- "복 사" 버튼 → `navigator.clipboard.writeText(finding.suggested)` + 1초간 "복사됨" 토스트
- "다음/이전 지적사항" → `/review/[id]/findings/[findingId]` 라우트 이동
- "PDF 다운로드" 버튼 (헤더에 추가) → `window.print()` 호출, 사용자가 PDF로 저장

## 9. 접근성

- 위험도 마크는 시각 + 텍스트 라벨 항상 병기
- 표 셀에 `<th scope="row">` 사용
- 본문/시정안 박스에 `aria-label` 또는 가시 라벨

## 10. 참고 — 시안 파일 위치

이 명세의 시각적 레퍼런스는 `취업규칙프론트엔드/screens-report.jsx`. 이식 시:
- 로컬 컴포넌트(`SectionTitle`, `Cell`, `RiskMark`, `PatternSwatch`, `FieldLabel`)는 그대로 옮길 것
- 인라인 스타일은 CSS Modules 또는 Tailwind로 변환 가능 — 단, **색상 값은 그대로 유지**
- `screens-report.jsx`의 `REPORT_DATA`는 mock. 실제로는 API에서 `ReportSummary` + `Finding`을 받아 채울 것

## 11. 클로드 코드에 줄 한 줄 지시

```
취업규칙프론트엔드/screens-report.jsx + REPORT_SPEC.md를 읽고,
이 명세대로 app/review/[id]/page.tsx 를 만들어. 흑백/인쇄 친화 원칙 절대 준수.
API는 아직 없으니 sample-data.jsx의 SAMPLE_FINDINGS를 mock으로 import해서 동작시켜.
```
