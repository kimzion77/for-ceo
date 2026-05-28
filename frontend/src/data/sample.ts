/**
 * 샘플 검토 데이터 (mock)
 *
 * 시안 `sample-data.jsx` 의 SAMPLE_FINDINGS / SAMPLE_SUMMARY 를
 * TypeScript 로 옮긴 mock — 다음 단계에서 백엔드 응답으로 교체된다.
 */
import type {
  Finding,
  PriorityItem,
  ReviewResult,
  ReviewSummary,
  RiskLevel,
} from '@/types/review';

/** 5-Bucket 우선순위 — 누락 > 위반 > 주의 > 검토필요. */
const BUCKET_ORDER: Record<RiskLevel, number> = {
  missing: 0,
  violation: 1,
  warn: 2,
  ambiguous: 3,
  ok: 4,
  skipped: 5,
};

/**
 * "가장 먼저 시정해야 할 항목" 자동 추출.
 *
 * 1차: 5-Bucket 순서 (누락 → 위반 → 주의 → 검토필요)
 * 2차: 같은 분류 내 finding 원래 순서 (백엔드 권고 순서 보존)
 * — 적정·선택 제외, 상위 N건
 *
 * 추후 백엔드 연동 시 `violation_severity` (CRITICAL/HIGH/MEDIUM/LOW) 가
 * 추가되면 2차 정렬 기준에 끼워넣는다.
 */
export function pickTopPriority(findings: Finding[], n = 3): PriorityItem[] {
  return findings
    .filter((f) => f.risk !== 'ok' && f.risk !== 'skipped')
    .slice() // 원본 보존
    .sort((a, b) => BUCKET_ORDER[a.risk] - BUCKET_ORDER[b.risk])
    .slice(0, n)
    .map((f) => ({
      id: f.id,
      risk: f.risk,
      title: f.title,
      article: f.article,
    }));
}

export const SAMPLE_FINDINGS: Finding[] = [
  {
    id: 'S-014',
    slotId: 'WORKHOURS_OVERTIME_LIMIT',
    article: '제24조',
    articleTitle: '연장근로',
    risk: 'violation',
    status: 'VIOLATION',
    title: '연장근로 한도가 법정 기준을 초과합니다',
    reason:
      '사업장 취업규칙은 1주 연장근로를 **최대 16시간**까지 허용한다고 규정하고 있습니다. 그러나 **근로기준법 제53조는 1주 12시간**을 한도로 정하고 있습니다. **법정 한도를 4시간 초과**하므로 시정이 필요합니다.',
    quote:
      '제24조(연장근로) 회사는 업무상 필요한 경우 근로자대표와 서면 합의에 따라 1주 16시간을 한도로 연장근로를 명할 수 있다.',
    extracted: '1주 16시간',
    standard: '1주 12시간',
    laws: [
      {
        name: '근로기준법 제53조',
        text: '당사자 간 합의가 있는 경우에는 1주간에 12시간을 한도로 제50조의 근로시간을 연장할 수 있다.',
      },
    ],
    penalty: {
      omission: [],
      violation: [
        '근로기준법 제110조 — 2년 이하 징역 또는 2,000만원 이하 벌금',
      ],
    },
    suggested:
      '제24조(연장근로) 회사는 업무상 필요한 경우 근로자대표와 서면 합의에 따라 1주 12시간을 한도로 연장근로를 명할 수 있다.',
    topics: ['근로시간', '연장근로', '12시간 한도'],
  },
  {
    id: 'S-027',
    slotId: 'ANNUAL_LEAVE_GRANT',
    article: '제38조',
    articleTitle: '연차유급휴가',
    risk: 'missing',
    status: 'MISSING',
    title: '1년 미만 근로자에 대한 월차 부여 누락',
    reason:
      '계속근로기간이 **1년 미만**인 근로자에게는 **1개월 개근 시 1일의 유급휴가**를 부여해야 합니다. 본문에는 1년 이상 근속자에 대한 15일 휴가만 규정되어 있어 **1년 미만 근로자에 대한 월차 부여 조항이 누락**되어 있습니다.',
    quote: '제38조(연차유급휴가) ① 1년간 80% 이상 출근한 근로자에게는 15일의 유급휴가를 준다.',
    extracted: '1년 이상 근속자만 명시',
    standard: '1년 미만 근로자: 월 1일 + 1년 이상: 15일',
    laws: [
      {
        name: '근로기준법 제60조 제2항',
        text: '사용자는 계속하여 근로한 기간이 1년 미만인 근로자 또는 1년간 80퍼센트 미만 출근한 근로자에게 1개월 개근 시 1일의 유급휴가를 주어야 한다.',
      },
    ],
    penalty: {
      omission: [
        '근로기준법 제116조 — 500만원 이하 과태료 (취업규칙 필수기재 누락)',
      ],
      violation: [
        '근로기준법 제110조 — 2년 이하 징역 또는 2,000만원 이하 벌금 (연차휴가 미부여)',
      ],
    },
    suggested:
      '② 계속근로기간이 1년 미만인 근로자 또는 1년간 80% 미만 출근한 근로자에게는 1개월 개근 시 1일의 유급휴가를 부여한다.',
    topics: ['연차휴가', '1년미만', '월차'],
  },
  {
    id: 'S-051',
    slotId: 'MATERNITY_LEAVE_PERIOD',
    article: '제45조',
    articleTitle: '출산전후휴가',
    risk: 'missing',
    status: 'MISSING',
    title: '다태아 출산휴가 기간 명시 누락',
    reason:
      '출산전후휴가는 단태아는 **90일**, **다태아(쌍둥이 등)는 120일**을 부여해야 합니다. 현재 규정은 90일만 명시되어 있어 **다태아 임신 근로자에 대한 안내가 누락**되어 있습니다. 분쟁 예방을 위해 명시를 권장드립니다.',
    quote: '제45조(출산전후휴가) 임신 중의 여성근로자에게 90일의 출산전후휴가를 준다.',
    extracted: '90일만 명시',
    standard: '단태아 90일 / 다태아 120일',
    laws: [
      {
        name: '근로기준법 제74조 제1항',
        text: '사용자는 임신 중의 여성에게 출산 전과 후를 통하여 90일(한 번에 둘 이상의 자녀를 임신한 경우에는 120일)의 출산전후휴가를 주어야 한다.',
      },
    ],
    penalty: {
      omission: [
        '근로기준법 제116조 — 500만원 이하 과태료 (출산휴가 기재 의무)',
      ],
      violation: [],
    },
    suggested:
      '제45조(출산전후휴가) 임신 중의 여성근로자에게 90일(한 번에 둘 이상의 자녀를 임신한 경우 120일)의 출산전후휴가를 부여한다.',
    topics: ['출산휴가', '다태아'],
  },
  {
    id: 'S-063',
    slotId: 'DISCIPLINARY_PROCEDURE',
    article: '제62조',
    articleTitle: '징계절차',
    risk: 'warn',
    status: 'WARN',
    title: '징계 소명 기회 절차 표현이 모호합니다',
    reason:
      '징계 시 본인에게 소명할 기회를 부여하도록 규정하고 있으나, **구체적인 통지 기간**(예: 7일 전 서면 통지)이 명시되지 않아 **분쟁 발생 시 절차적 정당성을 입증하기 어려울** 수 있습니다.',
    quote: '제62조(징계절차) 회사는 징계 시 본인에게 소명할 기회를 부여한다.',
    extracted: '소명 기회만 명시, 통지 기간 없음',
    standard: '통지 기간(권장 7일) 명시',
    laws: [
      {
        name: '판례(대법원 91다41897)',
        text: '징계대상자에게 충분한 변명의 기회를 주지 않은 징계는 절차적 하자로 무효',
      },
    ],
    penalty: {
      omission: [],
      violation: [],
    },
    suggested:
      '제62조(징계절차) 회사는 징계 시 징계위원회 개최 7일 전까지 본인에게 일시·장소·사유를 서면으로 통지하고, 본인의 출석 및 소명 기회를 부여한다.',
    topics: ['징계', '소명', '절차'],
  },
  {
    id: 'S-072',
    slotId: 'RETIREMENT_AGE',
    article: '제68조',
    articleTitle: '정년',
    risk: 'ambiguous',
    status: 'AMBIGUOUS',
    title: '정년 표현이 모호하여 추가 검토가 필요합니다',
    reason:
      '정년을 만 60세로 정한다고 명시되어 있으나 **"회사가 정한 직급별로 다를 수 있다"는 단서**가 있어 **직급에 따라 60세 미만**으로 적용될 가능성이 있습니다. 고령자고용법은 정년을 **60세 이상**으로 정하도록 강제하므로 확인이 필요합니다.',
    quote:
      '제68조(정년) 근로자의 정년은 만 60세로 한다. 다만, 회사가 정한 직급별로 다를 수 있다.',
    extracted: '만 60세 + 직급별 차등 단서',
    standard: '정년 60세 이상 (차등 시 모두 60세 이상)',
    laws: [
      {
        name: '고용상 연령차별금지법 제19조',
        text: '사업주는 근로자의 정년을 60세 이상으로 정하여야 한다.',
      },
    ],
    penalty: {
      omission: [],
      violation: [
        '고용상 연령차별금지법 제24조 — 500만원 이하 과태료 (60세 미만 정년)',
      ],
    },
    suggested:
      '제68조(정년) 근로자의 정년은 만 60세로 한다. 직급별로 정년을 달리 정할 경우에도 만 60세 미만으로 정할 수 없다.',
    topics: ['정년', '고령자고용법'],
  },
];

/**
 * 비스코스 실제 검토 분포 (회귀 검증 기준):
 *   누락 10 · 위반 11 · 주의 3 · 검토필요 1 · 적정 90 · 선택 51 = 합 166
 *   (115개 필수 검사항목 + 51개 선택조항 디스플레이)
 *
 * `verdictKey` 는 가장 강한 톤 — 누락이 1건 이상이면 'missing'.
 */
export const SAMPLE_SUMMARY: ReviewSummary = {
  verdict: '부적정',
  verdictKey: 'missing',
  fileName: '2.비스코스 취업규칙.docx',
  fileSize: '84.4KB',
  reviewedAt: '2026-04-29 14:32',
  duration: '1분 18초',
  totalSlots: 115,
  counts: { missing: 10, violation: 11, warn: 3, ambiguous: 1, ok: 90, skipped: 51 },
  articles: 98,
  // 자동 추출 — 5-Bucket 우선순위로 SAMPLE_FINDINGS 에서 Top 3
  topPriority: pickTopPriority(SAMPLE_FINDINGS, 3),
};

export const SAMPLE_RESULT: ReviewResult = {
  summary: SAMPLE_SUMMARY,
  findings: SAMPLE_FINDINGS,
};
