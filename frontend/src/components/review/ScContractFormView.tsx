'use client';

/**
 * 공통 표준계약서 양식 화면 — 고용노동부 공통 표준계약서(2023.12 제정 권고)
 * 서식 레이아웃 재현. 계약 당사자는 '사업주(위탁자)'와 '노무제공자(수탁자)'.
 *
 * 생성 텍스트 대신 **공식 표준 양식 모양 그대로** 보여주고, 사용자의 계약
 * 내용을 해당 칸에 채워 넣는다. 채움 규칙은 결정적(deterministic):
 *   1) structuredData(4섹션·16슬롯)의 value 를 양식 칸에 매핑
 *      (LLM 자유 텍스트 파싱 금지)
 *   2) 분석 항목이 부적절/보완필요로 판정된 칸은
 *      - 사용자가 담은 표현(userOverrides)이 "칸에 넣을 수 있는 값"이면
 *        그 값으로 (보완됨·override)
 *      - 아니면 공통 표준계약서의 해당 조항 표준 문구로 (보완됨·standard)
 *      - 표준 문구가 없는 칸(보수액·날짜·인적사항 등)은 원래 값 유지 +
 *        확인필요 표시
 *   3) 비어있으면 빈 밑줄 칸으로 둠
 *
 * 모든 칸은 controlled input — 수정 즉시 onChange 로 상위(page)에 전달되어
 * 다운로드(.docx)/복사/인쇄가 항상 최신 편집본을 사용한다.
 */
import { useCallback } from 'react';

import type { ScAnalysisResult, ScStructuredData } from '@/lib/api/sc';

import styles from './ScContractFormView.module.css';

/* ───────────────────────── 타입 ───────────────────────── */

export type ScFormFieldId =
  | 'employerName' // 전문 — 위탁자(사업주)
  | 'workerName' // 전문 — 수탁자(노무제공자)
  | 'purposeJob' // 제1조 ( )업무
  | 'basicPrinciple' // 제2조 기본원칙
  | 'term1' // 제3조 용어 정의 1~4
  | 'term2'
  | 'term3'
  | 'term4'
  | 'taskItem1' // 제4조 ① 1·2
  | 'taskItem2'
  | 'workMethod' // 제4조 ② — 노무제공 방식(자율성)
  | 'workPlace' // 제4조 ④ — 주된 노무제공 장소
  | 'contractPeriod' // 제5조 ①
  | 'renewNotice' // 제5조 ② ( )일
  | 'renewUnit' // 제5조 ② (주·월·연 단위)
  | 'feeBasis' // 제7조 ① 1. 항목·지급기준
  | 'feeTiming' // 제7조 ① 2. 지급 시기/방법
  | 'feeDeduction' // 제7조 ① 3. 공제 내역/기준
  | 'feeSpecial' // 제7조 ① 4. 기타 조건(특약)
  | 'feeObjectionDays' // 제7조 ③ ( )일
  | 'terminationClause' // 제11조
  | 'damagesClause' // 제12조
  | 'disputeClause' // 제13조
  | 'safetyClause' // 제14조
  | 'insuranceClause' // 제15조
  | 'contractDate' // 서명란 — 작성일
  | 'employerCompany' // 서명란 — 위탁자
  | 'employerAddress'
  | 'employerRep'
  | 'workerSignName' // 서명란 — 수탁자
  | 'workerAddress'
  | 'workerContact';

export interface ScContractFormState {
  fields: Record<ScFormFieldId, string>;
}

/**
 * 칸 표시 플래그.
 * - standard  : 표준 양식 문구로 보완됨 (초록)
 * - override  : 사용자가 담은 표현으로 보완됨 (초록)
 * - attention : 부적절/보완필요 판정인데 자동 보완 불가 — 직접 확인 (주황)
 */
export type ScFieldFlag = 'standard' | 'override' | 'attention';

export type ScFormFlags = Partial<
  Record<ScFormFieldId | 'signature', ScFieldFlag>
>;

export interface ScFormModel {
  state: ScContractFormState;
  flags: ScFormFlags;
}

/* ─────────────── 표준 양식 문구 (공통 표준계약서 2023.12) ─────────────── */
/* 출처: backend/data/standards/공통표준계약서_2023.txt 전문. */

const GUIDE_TEXT =
  '공통 표준계약서는 업무를 위탁하는 자와 업무를 수탁받는 자가 동등한 지위에서 계약조건에 관한 최소한의 기본적인 사항을 정하고, 이를 성실히 준수하고 공정하게 이행할 수 있도록 마련되었습니다. 계약당사자는 공통 표준계약서의 기본 틀과 내용을 유지하는 범위 내에서 직종별 특성을 반영하여 더 상세하고 개별적인 사항을 계약서에 규정할 수 있습니다.';

/** 부적절/보완필요 칸을 채울 표준 문구 — 해당 조항의 서식 원문. */
const STANDARD_PHRASES: Partial<Record<ScFormFieldId, string>> = {
  basicPrinciple:
    '위탁자와 수탁자는 상호 대등한 입장에서 신의성실의 원칙에 따라 자신의 권리를 행사하며 의무를 이행한다.',
  workMethod:
    '수탁자는 자신의 책임과 계산으로 위탁업무의 목적, 시한 등의 달성에 필요한 합법적이고 합리적인 수단을 동원하여 업무를 수행하여야 한다.',
  terminationClause: [
    '① 위탁자와 수탁자는 계약기간 중 상호 합의하는 경우에는 본 계약을 해지할 수 있다.',
    '② 위탁자와 수탁자는 상대방이 다음 각호에 해당하는 경우에는 (    )일 이내에 시정할 것을 상대방에게 요구하고 상대방이 그 기간 내에 시정하지 않는 경우 본 계약을 해지할 수 있다.',
    '  1. 일방 당사자가 계약조건을 미이행한 경우',
    '  2. 수탁자가 업무 관련하여 위탁자 또는 제3자에게 손해를 끼친 경우',
    '③ 위탁자와 수탁자는 다음 각호에 해당하는 경우에는 즉시 본 계약을 해지할 수 있다.',
    '  1. 본 계약의 체결 또는 업무의 수행에 있어 거짓이나 그 밖의 부정한 방법을 사용한 경우',
    '  2. 업무의 수행에 필요한 법령상 면허 등의 취득에 관한 사항을 준수하지 않거나 면허 등이 정지 또는 취소되는 경우',
    '  3. 법률 또는 본 계약상의 의무를 현저히 위반하는 등 본 계약 관계를 계속하기 어려운 중대한 사유가 있는 경우',
    '④ 본 계약을 해지하고자 하는 자는 구체적인 해지사유를 명시하여 적정한 방법으로 상대방에게 해지 의사를 통보하여야 한다.',
  ].join('\n'),
  damagesClause: [
    '① 위탁자 또는 수탁자가 본인의 책임 있는 사유로 상대방 또는 제3자에게 손해를 발생시킨 경우 그 손해를 배상하여야 한다.',
    '② 위탁자와 수탁자 이외의 제3자의 귀책사유로 위탁자 또는 수탁자에게 손해가 발생한 경우 위탁자와 수탁자는 이에 대한 배상이 이루어질 수 있도록 서로에게 적극 협조한다.',
    '③ 위탁자는 자신의 손해가 수탁자의 고의 또는 과실로 인해 발생하지 않은 경우 그에 대한 책임을 수탁자에게 부담시켜서는 안 된다.',
  ].join('\n'),
  disputeClause: [
    '① 본 계약에 명시되지 아니한 사항은 관련 법령 및 일반 상거래 관행에 따른다.',
    '② 본 계약의 해석에 관한 사항 등에 다툼이 있는 경우에는 위탁자와 수탁자의 합의에 의해 해결한다.',
    '③ 제2항에 따라 분쟁이 해결되지 않는 경우에는 법원 등에서의 조정, 화해, 소송 등을 통해 분쟁을 해결한다.',
  ].join('\n'),
  safetyClause:
    '위탁자는 「산업안전보건법」, 「중대재해 처벌 등에 관한 법률」 등 제반 법률에 따른 안전 보건 관리 활동을 하여야 하고, 수탁자는 이에 적극 협조하여야 한다.',
  insuranceClause: [
    '① 수탁자는 「고용보험법」, 「산업재해보상보험법」 및 「고용보험 및 산업재해보상보험의 보험료징수 등에 관한 법률」이 정하는 바에 따라 고용보험과 산업재해보상보험에 가입한다.',
    '② 위탁자는 법률이 정하는 바에 따라 수탁자의 수수료 등에서 원천공제하여 제1항의 사회보험료를 납부할 수 있으며 이때 제7조를 준수하여야 한다.',
  ].join('\n'),
};

/* 고정 조문 (칸 없음 — 서식 원문 그대로 인쇄·출력). */
const ST4_1_LEAD = '① 위탁자는 수탁자에게 다음과 같은 업무를 위탁한다.';
const ST4_3 =
  '③ 수탁자는 제1항에서 정한 업무를 수행한 경우 그 결과를 위탁자가 지정한 방법으로 통지하여야 한다.';
const ST6 =
  '위탁자와 수탁자는 본 계약의 내용을 변경하고자 할 때에는 서면(「전자문서 및 전자거래 기본법」 제2조제1호에 따른 전자문서(이하 ‘전자문서’라고 함)를 포함한다.)으로 합의 또는 동의의 절차를 거쳐야 한다.';
const ST7_1_LEAD =
  '① 위탁자는 수탁자의 위탁업무 수행 대가인 수수료 등을 다음 각 호에 따라 지급하여야 한다.';
const ST7_2 =
  '② 위탁자는 제1항 제1호, 제3호, 제4호의 세부 항목 등 내역이 표기된 지급명세서(전자문서 포함)를 작성하여 교부하여야 한다.';
const ST8_1 =
  '① 위탁자가 우월한 경제적 지위를 활용하여 본 계약에서 정한 업무 이외의 일이나 계약 이행과 직접 관련이 없는 사항을 수탁자에게 요청할 경우, 수탁자는 해당 요구를 거절 또는 제11조에 따라 본 계약을 해지하거나, 위탁자와 협의하여 제6조에 따른 계약 변경의 절차를 거칠 수 있다.';
const ST8_2 =
  '② 위탁자는 정당한 사유 없이 수탁자에게 지급하여야 할 수수료 등의 일부 또는 전부를 지급하지 아니하거나 지연하여 지급하는 행위, 지급할 수수료 등을 감액하거나 지급한 수수료 등을 환수하는 행위를 하지 않는다.';
const ST9_1 = '① 위탁자는 수탁자의 사생활의 자유를 부당하게 침해하지 않는다.';
const ST9_2 =
  '② 위탁자는 수탁자의 국적, 성별, 종교, 장애 등을 이유로 하여 합리적인 사유 없이 업무수행 환경이나 조건을 차별하거나 그 밖의 불리한 조치를 하지 않는다.';
const ST10_1 =
  '① 위탁자는 수탁자의 개인정보 등을 정보주체 본인의 동의 없이 제3자에게 제공, 누설하거나 본 계약 목적 이외의 용도로 사용하여서는 안 된다.';
const ST10_2 =
  '② 위탁자는 수탁자가 업무를 수행함에 있어 필요한 정보와 자료를 위탁 또는 제공하여야 하며, 필요시 그에 대한 설명을 하여야 한다. 이때, 정보와 자료의 위탁 또는 제공에 필요한 비용은 제7조에서 정한 것 외에는 원칙적으로 위탁자가 부담하여야 한다.';
const ST10_3 =
  '③ 수탁자는 위탁자의 고객정보 또는 영업정보 기타 위탁자의 영업상 비밀을 제3자에게 제공, 누설하거나 본 계약 목적 이외의 용도로 사용하여서는 안 된다.';
const ST10_4 =
  '④ 위탁자와 수탁자는 업무위탁 및 위탁업무 수행과 관련하여 「개인정보 보호법」 등 개인정보 관련 법규를 준수한다.';
const CLOSING =
  '이 계약의 체결을 증명하기 위하여 계약서 2통을 작성하여 위탁자와 수탁자가 서명[「전자서명법」 제2조제2호에 따른 전자서명(서명자의 실지명의를 확인할 수 있는 것을 말한다)을 포함한다] 또는 기명날인한 후 각각 1통씩 보관한다.';

/* ───────────────── structuredData → 칸 매핑 스펙 ───────────────── */

interface ScFieldSpec {
  /** structuredData 슬롯 출처 — [섹션, 슬롯키] 우선순위 순. */
  sources: Array<[string, string]>;
  /**
   * 분석 결과 매칭 패턴 (항목·슬롯ID 정규화 후 비교).
   * '=' 접두는 항목 정확 일치만 허용.
   */
  patterns: string[];
}

const FIELD_SPECS: Record<ScFormFieldId, ScFieldSpec> = {
  employerName: {
    sources: [['당사자정보', '사업주']],
    patterns: ['사업주정보', '=사업주'],
  },
  workerName: {
    sources: [['당사자정보', '노무제공자']],
    patterns: ['노무제공자정보', '=노무제공자'],
  },
  purposeJob: {
    sources: [
      ['당사자정보', '적용직종'],
      ['계약기본', '업무내용'],
    ],
    patterns: ['적용직종', '직종분류'],
  },
  basicPrinciple: {
    sources: [], // 값은 별도 합성 (표준 문구 + 근로자성위장방지 슬롯)
    patterns: ['근로자성'],
  },
  term1: { sources: [], patterns: [] },
  term2: { sources: [], patterns: [] },
  term3: { sources: [], patterns: [] },
  term4: { sources: [], patterns: [] },
  taskItem1: {
    sources: [['계약기본', '업무내용']],
    patterns: ['업무내용'],
  },
  taskItem2: { sources: [], patterns: [] },
  workMethod: {
    sources: [['계약기본', '노무제공방식']],
    patterns: ['노무제공방식'],
  },
  workPlace: {
    sources: [['계약기본', '노무제공장소']],
    patterns: ['노무제공장소'],
  },
  contractPeriod: {
    sources: [['계약기본', '계약기간']],
    patterns: ['계약기간'],
  },
  renewNotice: { sources: [], patterns: [] },
  renewUnit: { sources: [], patterns: [] },
  feeBasis: {
    sources: [['보수및사회보험', '보수']],
    patterns: ['=보수', '보수수수료'],
  },
  feeTiming: {
    sources: [['보수및사회보험', '보수지급일']],
    patterns: ['보수지급일'],
  },
  feeDeduction: { sources: [], patterns: [] },
  feeSpecial: { sources: [], patterns: [] },
  feeObjectionDays: { sources: [], patterns: [] },
  terminationClause: {
    sources: [['보호및분쟁', '계약해지']],
    patterns: ['계약해지'],
  },
  damagesClause: {
    sources: [['보호및분쟁', '손해배상책임']],
    patterns: ['손해배상'],
  },
  disputeClause: {
    sources: [['보호및분쟁', '분쟁해결']],
    patterns: ['분쟁해결'],
  },
  safetyClause: {
    sources: [['보호및분쟁', '안전보건의무']],
    patterns: ['안전보건'],
  },
  insuranceClause: {
    sources: [], // 값은 산재보험·고용보험 두 슬롯에서 합성
    patterns: ['산재보험', '고용보험'],
  },
  contractDate: { sources: [], patterns: [] },
  employerCompany: {
    sources: [['당사자정보', '사업주']],
    patterns: [],
  },
  employerAddress: { sources: [], patterns: [] },
  employerRep: { sources: [], patterns: [] },
  workerSignName: {
    sources: [['당사자정보', '노무제공자']],
    patterns: [],
  },
  workerAddress: { sources: [], patterns: [] },
  workerContact: { sources: [], patterns: [] },
};

const FIELD_IDS = Object.keys(FIELD_SPECS) as ScFormFieldId[];

/* ───────────────────────── 헬퍼 ───────────────────────── */

/** 매칭용 정규화 — 공백·구두점 제거. */
function norm(s: string): string {
  return s.replace(/[\s·.\-_/()\[\]]/g, '');
}

/** 미기재/판독불가 등 placeholder 면 '' 로. */
function usable(v: string | undefined | null): string {
  if (!v) return '';
  const t = String(v).trim();
  if (!t) return '';
  const n = norm(t);
  if (
    n.startsWith('미기재') ||
    n.startsWith('판독불가') ||
    n.startsWith('기재없음') ||
    n === '해당없음' ||
    n === '알수없음' ||
    n === '-'
  ) {
    return '';
  }
  return t;
}

/** structuredData 슬롯 value 추출 — 런타임 방어적 접근 (LLM JSON). */
function slotValue(sd: ScStructuredData, section: string, key: string): string {
  const sec = (sd as unknown as Record<string, unknown>)[section];
  if (!sec || typeof sec !== 'object' || Array.isArray(sec)) return '';
  const f = (sec as Record<string, unknown>)[key];
  if (!f || typeof f !== 'object') return '';
  const v = (f as { value?: unknown }).value;
  return usable(typeof v === 'string' ? v : '');
}

/**
 * 분석 결과에서 이 칸과 연관된 부적절/보완필요 항목 찾기 (부적절 우선).
 * userOverrides 의 key 는 결과 페이지(mobileFindings)와 동일하게
 * `슬롯ID || 항목` 이므로 두 후보 key 를 모두 돌려준다.
 */
function findFlag(
  analysis: ScAnalysisResult | null,
  patterns: string[],
): { status?: '부적절' | '보완필요'; overrideKeys: string[] } {
  if (!analysis || patterns.length === 0) return { overrideKeys: [] };
  let best: {
    status: '부적절' | '보완필요';
    overrideKeys: string[];
  } | null = null;
  for (const r of analysis.results ?? []) {
    const a = r.적절성;
    if (a !== '부적절' && a !== '보완필요') continue;
    const itemN = norm(r.항목 ?? '');
    const slotN = norm(r.슬롯ID ?? '');
    if (!itemN && !slotN) continue;
    const hit = patterns.some((p) => {
      if (p.startsWith('=')) return itemN === norm(p.slice(1));
      const np = norm(p);
      if (!np) return false;
      return (
        (itemN !== '' && itemN.includes(np)) ||
        (slotN !== '' && slotN.includes(np))
      );
    });
    if (!hit) continue;
    if (!best || (a === '부적절' && best.status === '보완필요')) {
      best = {
        status: a,
        overrideKeys: [r.슬롯ID, r.항목].filter(Boolean) as string[],
      };
    }
    if (best.status === '부적절') break;
  }
  return best ?? { overrideKeys: [] };
}

/**
 * userOverrides 값이 "칸에 넣을 수 있는 값"인지 — 설명문이면 버린다.
 * (개선권고 기본값은 "~하세요/~기재하세요" 류 지시문 — 칸 값이 아님)
 */
function usableOverride(raw: string | undefined): string {
  if (!raw) return '';
  const t = raw.trim().replace(/\s+/g, ' ');
  if (!t || t.length > 120) return '';
  if (/(입니다|합니다|하세요|해요|세요|해주세요|바랍니다|습니다|니다)[.!\s]*$/.test(t)) {
    return '';
  }
  if (/(권고|권장|위반|검토필요|검토가 필요|보완이 필요|필요합니다)/.test(t)) {
    return '';
  }
  return t;
}

/* ───────────────────── 모델 빌드 (결정적) ───────────────────── */

/**
 * structuredData + 분석 결과 + 사용자 담은 표현 → 양식 칸 초기값 + 플래그.
 * 순수 함수 — 같은 입력이면 항상 같은 출력 (LLM 텍스트 파싱 없음).
 */
export function buildScFormModel(
  sd: ScStructuredData,
  analysis: ScAnalysisResult | null,
  overrides: Record<string, string>,
): ScFormModel {
  const fields = {} as Record<ScFormFieldId, string>;
  const flags: ScFormFlags = {};

  // ── 1) 원본 값 추출 ──
  for (const id of FIELD_IDS) {
    const spec = FIELD_SPECS[id];
    let v = '';
    for (const [section, key] of spec.sources) {
      v = slotValue(sd, section, key);
      if (v) break;
    }
    fields[id] = v;
  }

  // ── 2) 합성 칸 — 제2조(기본원칙 + 근로자성), 제15조(산재·고용보험) ──
  const masking = slotValue(sd, '보호및분쟁', '근로자성위장방지');
  fields.basicPrinciple = masking
    ? `${STANDARD_PHRASES.basicPrinciple}\n${masking}`
    : (STANDARD_PHRASES.basicPrinciple as string);
  const sanjae = slotValue(sd, '보수및사회보험', '산재보험');
  const goyong = slotValue(sd, '보수및사회보험', '고용보험');
  if (sanjae || goyong) {
    fields.insuranceClause = [
      sanjae ? `- 산재보험 : ${sanjae}` : '',
      goyong ? `- 고용보험 : ${goyong}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // ── 3) 부적절/보완필요 칸 보완 (override → 표준 문구 → 확인필요) ──
  for (const id of FIELD_IDS) {
    const spec = FIELD_SPECS[id];
    const { status, overrideKeys } = findFlag(analysis, spec.patterns);
    if (!status) continue;
    const raw = overrideKeys
      .map((k) => overrides[k])
      .find((v) => v !== undefined);
    const ov = usableOverride(raw);
    if (ov) {
      fields[id] = ov;
      flags[id] = 'override';
    } else if (STANDARD_PHRASES[id]) {
      fields[id] = STANDARD_PHRASES[id] as string;
      flags[id] = 'standard';
    } else {
      flags[id] = 'attention';
    }
  }

  // ── 4) 조문 칸 기본값 — 비었거나 단답이면 표준 문구로 (플래그 없이) ──
  for (const id of Object.keys(STANDARD_PHRASES) as ScFormFieldId[]) {
    if (!flags[id] && fields[id].trim().length < 15) {
      fields[id] = STANDARD_PHRASES[id] as string;
    }
  }

  // ── 5) 서명란 — 자동 보완 불가, 판정만 표시 ──
  const signFlag = findFlag(analysis, ['서명날인', '=서명']);
  if (signFlag.status) flags.signature = 'attention';

  return { state: { fields }, flags };
}

/* ───────────────────── 텍스트 렌더 (.docx/복사용) ───────────────────── */

function blank(v: string, n = 10): string {
  const t = v.trim();
  return t ? t : '_'.repeat(n);
}

/** 채워진 양식 → 조항 순서대로 평문 렌더 — downloadScDocx / 복사에 사용. */
export function buildScContractText(state: ScContractFormState): string {
  const f = state.fields;
  const L: string[] = [];
  L.push('공 통 표 준 계 약 서');
  L.push('');
  L.push(GUIDE_TEXT);
  L.push('');
  L.push(
    `${blank(f.employerName, 12)} (이하 ‘위탁자’라 함)과(와) ${blank(f.workerName, 12)} (이하 ‘수탁자’라 함)은 다음과 같이 계약(이하 ‘본 계약’이라 함)을 체결한다.`,
  );
  L.push('');
  L.push('제1조 (계약의 목적)');
  L.push(
    `본 계약의 목적은 위탁자가 수탁자에게 ( ${blank(f.purposeJob)} ) 업무를 위탁함에 있어 상호간의 권리·의무 및 기타 제반 사항을 규정함에 있다.`,
  );
  L.push('');
  L.push('제2조 (기본원칙)');
  L.push(f.basicPrinciple.trim() || (STANDARD_PHRASES.basicPrinciple as string));
  L.push('');
  L.push('제3조 (용어 정의)');
  L.push('본 계약에서 사용하는 용어의 정의는 다음과 같다.');
  L.push(`1. ${blank(f.term1, 20)}`);
  L.push(`2. ${blank(f.term2, 20)}`);
  L.push(`3. ${blank(f.term3, 20)}`);
  L.push(`4. ${blank(f.term4, 20)}`);
  L.push('');
  L.push('제4조 (위탁업무의 내용 및 수행)');
  L.push(ST4_1_LEAD);
  L.push(`  1. ${blank(f.taskItem1, 20)}`);
  L.push(`  2. ${blank(f.taskItem2, 20)}`);
  L.push(`② ${f.workMethod.trim() || (STANDARD_PHRASES.workMethod as string)}`);
  L.push(ST4_3);
  L.push(
    `④ 수탁자가 노무를 제공하는 주된 장소는 ( ${blank(f.workPlace)} )(으)로 한다.`,
  );
  L.push('');
  L.push('제5조 (계약기간)');
  L.push(`① 본 계약의 유효기간은 ( ${blank(f.contractPeriod, 16)} )(으)로 한다.`);
  L.push(
    `② 계약기간 만료 ( ${blank(f.renewNotice, 4)} )일 전까지 위탁자 또는 수탁자가 계약 종료의 의사를 표시하지 아니하는 한 동일 조건으로 ( ${blank(f.renewUnit, 4)} ) 단위로 계약이 자동 갱신된 것으로 본다.`,
  );
  L.push('');
  L.push('제6조 (계약의 변경)');
  L.push(ST6);
  L.push('');
  L.push('제7조 (수수료 또는 보수(이하 ‘수수료 등’)의 지급 등)');
  L.push(ST7_1_LEAD);
  L.push(`  1. 수수료 등 항목 및 지급기준 : ${blank(f.feeBasis, 20)}`);
  L.push(`  2. 지급 시기/방법 : ${blank(f.feeTiming, 20)}`);
  L.push(`  3. 공제 내역/기준 : ${blank(f.feeDeduction, 20)}`);
  L.push(`  4. 관련 기타 조건(특약) : ${blank(f.feeSpecial, 20)}`);
  L.push(ST7_2);
  L.push(
    `③ 수탁자는 제2항에 따른 지급명세서가 본 계약 내용과 맞지 않는 경우 이의를 제기할 수 있으며, 위탁자는 이에 대한 확인 결과를 ( ${blank(f.feeObjectionDays, 4)} )일 이내에 적정한 방법으로 통지하여야 한다.`,
  );
  L.push('');
  L.push('제8조 (불공정거래 행위 금지 등)');
  L.push(ST8_1);
  L.push(ST8_2);
  L.push('');
  L.push('제9조 (부당한 처우의 금지 등)');
  L.push(ST9_1);
  L.push(ST9_2);
  L.push('');
  L.push('제10조 (정보이용 및 정보제공)');
  L.push(ST10_1);
  L.push(ST10_2);
  L.push(ST10_3);
  L.push(ST10_4);
  L.push('');
  L.push('제11조 (계약의 해지 등)');
  L.push(
    f.terminationClause.trim() || (STANDARD_PHRASES.terminationClause as string),
  );
  L.push('');
  L.push('제12조 (손해배상)');
  L.push(f.damagesClause.trim() || (STANDARD_PHRASES.damagesClause as string));
  L.push('');
  L.push('제13조 (분쟁 해결)');
  L.push(f.disputeClause.trim() || (STANDARD_PHRASES.disputeClause as string));
  L.push('');
  L.push('제14조 (안전보건 조치 등)');
  L.push(f.safetyClause.trim() || (STANDARD_PHRASES.safetyClause as string));
  L.push('');
  L.push('제15조 (사회보험 가입)');
  L.push(
    f.insuranceClause.trim() || (STANDARD_PHRASES.insuranceClause as string),
  );
  L.push('');
  L.push(CLOSING);
  L.push('');
  L.push(f.contractDate.trim() ? f.contractDate.trim() : '        년    월    일');
  L.push('');
  L.push(`(위탁자) 상    호 : ${blank(f.employerCompany, 14)}`);
  L.push(`         주    소 : ${blank(f.employerAddress, 16)}`);
  L.push(`         대 표 자 : ${blank(f.employerRep)} (서명)`);
  L.push(`(수탁자) 성    명 : ${blank(f.workerSignName)} (서명)`);
  L.push(`         주    소 : ${blank(f.workerAddress, 16)}`);
  L.push(`         연 락 처 : ${blank(f.workerContact, 8)}`);
  return L.join('\n');
}

/* ───────────────────────── 컴포넌트 ───────────────────────── */

const FLAG_WRAP_CLASS: Record<ScFieldFlag, string> = {
  standard: styles.flagFix,
  override: styles.flagFix,
  attention: styles.flagWarn,
};

function chipFor(flag: ScFieldFlag | undefined) {
  if (!flag) return null;
  if (flag === 'attention') {
    return <em className={`${styles.chip} ${styles.chipWarn}`}>확인필요</em>;
  }
  return <em className={`${styles.chip} ${styles.chipFix}`}>보완됨</em>;
}

interface ScContractFormViewProps {
  value: ScContractFormState;
  flags: ScFormFlags;
  onChange: (next: ScContractFormState) => void;
}

export default function ScContractFormView({
  value,
  flags,
  onChange,
}: ScContractFormViewProps) {
  const setField = useCallback(
    (id: ScFormFieldId, v: string) => {
      onChange({ ...value, fields: { ...value.fields, [id]: v } });
    },
    [value, onChange],
  );

  const autoGrow = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // 주의: 컴포넌트가 아닌 일반 함수 — 매 렌더 새 컴포넌트 타입이 되면
  // input 이 remount 되어 포커스를 잃는다.
  const renderField = (
    id: ScFormFieldId,
    label: string,
    w: 'sm' | 'md' | 'lg' | 'xl' | 'full' = 'md',
  ) => {
    const flag = flags[id];
    return (
      <span
        className={`${styles.fieldWrap} ${flag ? FLAG_WRAP_CLASS[flag] : ''}`}
      >
        <input
          type="text"
          className={`${styles.field} ${styles[`w_${w}`]}`}
          value={value.fields[id]}
          onChange={(e) => setField(id, e.target.value)}
          aria-label={label}
          spellCheck={false}
        />
        {chipFor(flag)}
      </span>
    );
  };

  const renderArea = (id: ScFormFieldId, label: string) => {
    const flag = flags[id];
    return (
      <span
        className={`${styles.areaWrap} ${flag ? FLAG_WRAP_CLASS[flag] : ''}`}
      >
        <textarea
          ref={autoGrow}
          rows={2}
          className={styles.area}
          value={value.fields[id]}
          onChange={(e) => setField(id, e.target.value)}
          onInput={(e) => autoGrow(e.currentTarget)}
          aria-label={label}
          spellCheck={false}
        />
        {chipFor(flag)}
      </span>
    );
  };

  return (
    <div className={styles.paper}>
      <h2 className={styles.formTitle}>공 통 표 준 계 약 서</h2>

      <p className={styles.guide}>{GUIDE_TEXT}</p>

      <p className={styles.intro}>
        {renderField('employerName', '위탁자(사업주) 명칭', 'md')}
        <span className={styles.introText}>(이하 ‘위탁자’라 함)과(와)</span>
        {renderField('workerName', '수탁자(노무제공자) 성명', 'md')}
        <span className={styles.introText}>
          (이하 ‘수탁자’라 함)은 다음과 같이 계약(이하 ‘본 계약’이라 함)을
          체결한다.
        </span>
      </p>

      <ol className={styles.clauses}>
        <li className={styles.clause}>
          <span className={styles.clauseTitle}>제1조 (계약의 목적)</span>
          <p className={styles.staticPara}>
            본 계약의 목적은 위탁자가 수탁자에게 (
            {renderField('purposeJob', '위탁 업무(직종)', 'md')}
            <span className={styles.inlineText}>
              ) 업무를 위탁함에 있어 상호간의 권리·의무 및 기타 제반 사항을
              규정함에 있다.
            </span>
          </p>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>제2조 (기본원칙)</span>
          <div className={styles.subItem}>
            {renderArea('basicPrinciple', '기본원칙 (대등한 지위·근로자성 위장 방지)')}
          </div>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>제3조 (용어 정의)</span>
          <p className={styles.staticPara}>
            본 계약에서 사용하는 용어의 정의는 다음과 같다.
          </p>
          <div className={styles.subItem}>
            <span className={styles.subLabel}>1.</span>
            {renderField('term1', '용어 정의 1', 'xl')}
          </div>
          <div className={styles.subItem}>
            <span className={styles.subLabel}>2.</span>
            {renderField('term2', '용어 정의 2', 'xl')}
          </div>
          <div className={styles.subItem}>
            <span className={styles.subLabel}>3.</span>
            {renderField('term3', '용어 정의 3', 'xl')}
          </div>
          <div className={styles.subItem}>
            <span className={styles.subLabel}>4.</span>
            {renderField('term4', '용어 정의 4', 'xl')}
          </div>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>
            제4조 (위탁업무의 내용 및 수행)
          </span>
          <p className={styles.staticPara}>{ST4_1_LEAD}</p>
          <div className={styles.subItem}>
            <span className={styles.subLabel}>1.</span>
            {renderField('taskItem1', '위탁업무 내용 1', 'xl')}
          </div>
          <div className={styles.subItem}>
            <span className={styles.subLabel}>2.</span>
            {renderField('taskItem2', '위탁업무 내용 2', 'xl')}
          </div>
          <div className={styles.subItem}>
            <span className={styles.subLabel}>②</span>
            {renderArea('workMethod', '노무제공 방식 (자율성 보장)')}
          </div>
          <p className={styles.staticPara}>{ST4_3}</p>
          <p className={styles.staticPara}>
            ④ 수탁자가 노무를 제공하는 주된 장소는 (
            {renderField('workPlace', '주된 노무제공 장소', 'md')}
            <span className={styles.inlineText}>)(으)로 한다.</span>
          </p>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>제5조 (계약기간)</span>
          <p className={styles.staticPara}>
            ① 본 계약의 유효기간은 (
            {renderField('contractPeriod', '계약기간', 'lg')}
            <span className={styles.inlineText}>)(으)로 한다.</span>
          </p>
          <p className={styles.staticPara}>
            ② 계약기간 만료 (
            {renderField('renewNotice', '계약 종료 의사표시 기한(일)', 'sm')}
            <span className={styles.inlineText}>
              )일 전까지 위탁자 또는 수탁자가 계약 종료의 의사를 표시하지
              아니하는 한 동일 조건으로 (
            </span>
            {renderField('renewUnit', '자동갱신 단위(주·월·연)', 'sm')}
            <span className={styles.inlineText}>
              ) 단위로 계약이 자동 갱신된 것으로 본다.
            </span>
          </p>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>제6조 (계약의 변경)</span>
          <p className={styles.staticPara}>{ST6}</p>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>
            제7조 (수수료 또는 보수(이하 ‘수수료 등’)의 지급 등)
          </span>
          <p className={styles.staticPara}>{ST7_1_LEAD}</p>
          <div className={styles.subItem}>
            <span className={styles.subLabel}>1. 수수료 등 항목 및 지급기준 :</span>
            {renderArea('feeBasis', '수수료 등 항목 및 지급기준')}
          </div>
          <div className={styles.subItem}>
            <span className={styles.subLabel}>2. 지급 시기/방법 :</span>
            {renderArea('feeTiming', '수수료 등 지급 시기·방법')}
          </div>
          <div className={styles.subItem}>
            <span className={styles.subLabel}>3. 공제 내역/기준 :</span>
            {renderArea('feeDeduction', '공제 내역·기준')}
          </div>
          <div className={styles.subItem}>
            <span className={styles.subLabel}>4. 관련 기타 조건(특약) :</span>
            {renderArea('feeSpecial', '관련 기타 조건(특약)')}
          </div>
          <p className={styles.staticPara}>{ST7_2}</p>
          <p className={styles.staticPara}>
            ③ 수탁자는 제2항에 따른 지급명세서가 본 계약 내용과 맞지 않는 경우
            이의를 제기할 수 있으며, 위탁자는 이에 대한 확인 결과를 (
            {renderField('feeObjectionDays', '이의 확인 결과 통지 기한(일)', 'sm')}
            <span className={styles.inlineText}>
              )일 이내에 적정한 방법으로 통지하여야 한다.
            </span>
          </p>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>
            제8조 (불공정거래 행위 금지 등)
          </span>
          <p className={styles.staticPara}>{ST8_1}</p>
          <p className={styles.staticPara}>{ST8_2}</p>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>
            제9조 (부당한 처우의 금지 등)
          </span>
          <p className={styles.staticPara}>{ST9_1}</p>
          <p className={styles.staticPara}>{ST9_2}</p>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>
            제10조 (정보이용 및 정보제공)
          </span>
          <p className={styles.staticPara}>{ST10_1}</p>
          <p className={styles.staticPara}>{ST10_2}</p>
          <p className={styles.staticPara}>{ST10_3}</p>
          <p className={styles.staticPara}>{ST10_4}</p>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>제11조 (계약의 해지 등)</span>
          <div className={styles.subItem}>
            {renderArea('terminationClause', '계약 해지 사유·절차')}
          </div>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>제12조 (손해배상)</span>
          <div className={styles.subItem}>
            {renderArea('damagesClause', '손해배상·책임 한계')}
          </div>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>제13조 (분쟁 해결)</span>
          <div className={styles.subItem}>
            {renderArea('disputeClause', '분쟁 해결 방법')}
          </div>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>제14조 (안전보건 조치 등)</span>
          <div className={styles.subItem}>
            {renderArea('safetyClause', '안전보건 조치')}
          </div>
        </li>

        <li className={styles.clause}>
          <span className={styles.clauseTitle}>제15조 (사회보험 가입)</span>
          <div className={styles.subItem}>
            {renderArea('insuranceClause', '산재보험·고용보험 가입')}
          </div>
        </li>
      </ol>

      <p className={styles.closing}>{CLOSING}</p>

      <div className={styles.dateRow}>
        {renderField('contractDate', '계약 체결일', 'lg')}
      </div>

      <div className={styles.signBlock}>
        {flags.signature && (
          <div className={styles.signNotice}>
            {chipFor(flags.signature)}
            <span>
              서명·날인 누락이 지적됐어요 — 출력 후 위탁자·수탁자 양측 서명이
              필요해요.
            </span>
          </div>
        )}
        <div className={styles.signGroup}>
          <span className={styles.signParty}>(위탁자)</span>
          <div className={styles.signRows}>
            <div className={styles.signRow}>
              <span className={styles.signLabel}>상 호 :</span>
              {renderField('employerCompany', '위탁자 상호(사업체명)', 'md')}
            </div>
            <div className={styles.signRow}>
              <span className={styles.signLabel}>주 소 :</span>
              {renderField('employerAddress', '위탁자 주소', 'xl')}
            </div>
            <div className={styles.signRow}>
              <span className={styles.signLabel}>대 표 자 :</span>
              {renderField('employerRep', '위탁자 대표자', 'md')}
              <span className={styles.inlineText}>(서명)</span>
            </div>
          </div>
        </div>
        <div className={styles.signGroup}>
          <span className={styles.signParty}>(수탁자)</span>
          <div className={styles.signRows}>
            <div className={styles.signRow}>
              <span className={styles.signLabel}>성 명 :</span>
              {renderField('workerSignName', '수탁자 성명', 'md')}
              <span className={styles.inlineText}>(서명)</span>
            </div>
            <div className={styles.signRow}>
              <span className={styles.signLabel}>주 소 :</span>
              {renderField('workerAddress', '수탁자 주소', 'xl')}
            </div>
            <div className={styles.signRow}>
              <span className={styles.signLabel}>연 락 처 :</span>
              {renderField('workerContact', '수탁자 연락처', 'md')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
