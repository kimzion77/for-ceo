'use client';

import Card from '@/components/ui/Card';
import Term from '@/components/ui/Term';
import type { DocumentType, WorkplaceContext } from '@/types/review';
import { HELP_BUSINESS_SIZE } from './workplaceHelp';
import styles from './WorkplaceForm.module.css';

type TernaryValue = 'unknown' | 'yes' | 'no';

/** 사업장 규모 — 5인 이상/미만. */
export type BusinessSize = '5+' | '5-' | 'unknown';

/** 근로자 유형 — 다중 선택. */
export type WorkerType =
  | '정규직'
  | '기간제'
  | '단시간'
  | '일용직'
  | '연소자'
  | '외국인'
  | '외국인-농축어업';

export const ALL_WORKER_TYPES: WorkerType[] = [
  '정규직',
  '기간제',
  '단시간',
  '일용직',
  '연소자',
  '외국인',
  '외국인-농축어업',
];

/** 임금명세서 전용 — 계약 유형 단일 선택 (EC 의 다중 7옵션과 분리). */
export type WsContractType = '정규직' | '기간제' | '단시간' | '일용직';
export const WS_CONTRACT_TYPES: WsContractType[] = [
  '정규직',
  '기간제',
  '단시간',
  '일용직',
];

/** 임금 지급 주기. */
export type PayCycle = '월급' | '시급' | '일급';
export const PAY_CYCLES: PayCycle[] = ['월급', '시급', '일급'];

/** UI 상태 — Boolean | null 보다 라디오 친화적인 표현. */
export interface WorkplaceFormState {
  // 취업규칙용
  shiftWork: TernaryValue;
  chemicals: TernaryValue;
  envMonitor: TernaryValue;
  osh: boolean;

  // 근로계약서용 (다중) — 임금명세서에선 contractType 으로 자동 동기화
  businessSize: BusinessSize;
  workerTypes: WorkerType[];

  // 임금명세서 전용
  payPeriodYear: number;
  payPeriodMonth: number;
  contractType: WsContractType;
  payCycle: PayCycle;
  /** 주 소정근로시간 — 단시간 계약일 때만 의미. 40h / 44h / 임의 숫자. */
  weeklyHours: number;
}

// 기본값 — 현재 연·월
function _today() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export const DEFAULT_WORKPLACE: WorkplaceFormState = {
  shiftWork: 'unknown',
  chemicals: 'unknown',
  envMonitor: 'unknown',
  osh: true,
  businessSize: '5+',
  workerTypes: ['정규직'],
  payPeriodYear: _today().year,
  payPeriodMonth: _today().month,
  contractType: '정규직',
  payCycle: '월급',
  weeklyHours: 40,
};

/** UI 상태 → 백엔드 페이로드 변환. */
export function toWorkplaceContext(s: WorkplaceFormState): WorkplaceContext {
  const ternary = (v: TernaryValue): boolean | null =>
    v === 'unknown' ? null : v === 'yes';
  return {
    shiftWorkUsed: ternary(s.shiftWork),
    oshaApplicable: s.osh,
    chemicalHandling: ternary(s.chemicals),
    workenvMeasurement: ternary(s.envMonitor),
    businessSize: s.businessSize === 'unknown' ? null : s.businessSize,
    workerTypes: s.workerTypes,
    payPeriodYear: s.payPeriodYear,
    payPeriodMonth: s.payPeriodMonth,
    contractType: s.contractType,
    payCycle: s.payCycle,
    weeklyHours: s.weeklyHours,
  };
}

interface WorkplaceFormProps {
  value: WorkplaceFormState;
  onChange: (next: WorkplaceFormState) => void;
  /**
   * 선택된 문서 종류 — 호출부가 전달(하위호환). 현재는 모든 문서 유형이
   * 사업장 규모만 직접 입력하고 나머지는 AI 1차 판단으로 옮겨 분기 불필요.
   */
  documentType?: DocumentType;
}

export function WorkplaceForm({ value, onChange }: WorkplaceFormProps) {
  const patch = (p: Partial<WorkplaceFormState>) => onChange({ ...value, ...p });

  return (
    <Card padding={20}>
      {/* ── 섹션 1: 사업장 기본 (모든 문서 공통) ── */}
      <div className={styles.sectionTitle}>사업장 기본</div>
      <div className={styles.grid}>
        {/* 사업장 규모 */}
        <div className={styles.field}>
          <div className={styles.label}>
            <Term def={HELP_BUSINESS_SIZE} hideDelay={500} width={340}>
              사업장 규모
            </Term>
          </div>
          <div className={styles.options}>
            {[
              { value: '5+', label: '5인 이상' },
              { value: '5-', label: '5인 미만' },
            ].map((opt) => {
              const active = value.businessSize === opt.value;
              return (
                <label
                  key={opt.value}
                  className={`${styles.option} ${active ? styles.optionActive : ''}`}
                >
                  <input
                    type="radio"
                    checked={active}
                    onChange={() => patch({ businessSize: opt.value as BusinessSize })}
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
        </div>

        {/* 근로자 유형 (근로계약서) — 홈 폼에서는 묻지 않는다.
            AI 1차 분류가 판단하고, 사용자는 추출 확인 화면에서 [맞아요/아니에요]로
            확인만 하며, 아니에요일 때만 그 화면에서 직접 선택(ClassifyConfirm 칩).
            workerTypes 상태·기본값은 레거시 경로 fallback 으로 그대로 유지. */}

        {/* 계약 유형 (임금명세서) — 홈 폼에서는 묻지 않는다.
            AI 가 명세서를 읽고 1차 판단하고, 사용자는 분석 직전 확인 화면
            (WsTypeConfirm)에서 [맞아요/아니에요]로 확인만 한다.
            contractType 기본값은 레거시·분류 실패 fallback 으로 유지. */}
      </div>

      {/* 산정 대상·지급 조건 (임금명세서) — 홈 폼에서는 묻지 않는다.
          AI 가 명세서를 읽고 산정 연·월, 지급 주기, 주 소정근로시간을 추출하고,
          분석 직전 확인 화면(WsTypeConfirm)에서 함께 보여준다. 명세서에 안
          적혀 있으면 분석 단계에서 '필수 기재사항 누락' 위반으로 잡힌다.
          payPeriod*·payCycle·weeklyHours 상태·기본값은 fallback 으로 유지. */}

      {/* 근로 환경 (취업규칙) — 홈 폼에서는 묻지 않는다.
          사업장들이 잘 모르는 항목(교대제·산안법·화학물질·작업환경측정)이라
          AI 1차 분류가 취업규칙 본문을 읽고 추정하고, 사용자는 추출 확인
          화면에서 [맞아요/아니에요]로 확인만 한다 (WrEnvConfirm).
          shiftWork 등 폼 상태·기본값은 레거시 fallback 으로 그대로 유지. */}
    </Card>
  );
}

export default WorkplaceForm;
