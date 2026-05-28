'use client';

import type { ReactNode } from 'react';

import Card from '@/components/ui/Card';
import Term from '@/components/ui/Term';
import type { DocumentType, WorkplaceContext } from '@/types/review';
import {
  HELP_BUSINESS_SIZE,
  HELP_CHEM,
  HELP_OSHA,
  HELP_SHIFT,
  HELP_WORKENV,
  HELP_WORKER_TYPES,
} from './workplaceHelp';
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
  businessSize: 'unknown',
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

interface RadioOption {
  value: TernaryValue;
  label: string;
}

interface RadioGroupProps {
  label: string;
  tip: ReactNode;
  value: TernaryValue;
  onChange: (next: TernaryValue) => void;
  options: RadioOption[];
}

function RadioGroup({ label, tip, value, onChange, options }: RadioGroupProps) {
  return (
    <div className={styles.field}>
      <div className={styles.label}>
        <Term def={tip} hideDelay={500} width={320}>
          {label}
        </Term>
      </div>
      <div className={styles.options}>
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <label
              key={opt.value}
              className={`${styles.option} ${active ? styles.optionActive : ''}`}
            >
              <input
                type="radio"
                checked={active}
                onChange={() => onChange(opt.value)}
              />
              {opt.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

interface WorkplaceFormProps {
  value: WorkplaceFormState;
  onChange: (next: WorkplaceFormState) => void;
  /** 선택된 문서 종류 — 섹션 노출 분기. */
  documentType?: DocumentType;
}

export function WorkplaceForm({
  value,
  onChange,
  documentType = 'work-rules',
}: WorkplaceFormProps) {
  const patch = (p: Partial<WorkplaceFormState>) => onChange({ ...value, ...p });

  // 근로 환경 섹션은 취업규칙(work-rules) 검사에서만 사용
  const showWorkEnv = documentType === 'work-rules';
  // EC 다중 worker types — 근로계약서 전용 (연소자·외국인 등 다양한 슬롯 분기 필요).
  const showWorkerTypesMulti = documentType === 'employment-contract';
  // WS 전용 단순화된 컨텍스트
  const showWsContext = documentType === 'wage-statement';

  const toggleWorker = (t: WorkerType) => {
    const has = value.workerTypes.includes(t);
    patch({
      workerTypes: has
        ? value.workerTypes.filter((x) => x !== t)
        : [...value.workerTypes, t],
    });
  };

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
              { value: 'unknown', label: '모름' },
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

        {/* 근로자 유형 — 다중 선택 (근로계약서 전용) */}
        {showWorkerTypesMulti && (
          <div className={styles.field}>
            <div className={styles.label}>
              <Term def={HELP_WORKER_TYPES} hideDelay={500} width={360}>
                근로자 유형 (다중 선택)
              </Term>
            </div>
            <div className={styles.optionsWrap}>
              {ALL_WORKER_TYPES.map((t) => {
                const active = value.workerTypes.includes(t);
                return (
                  <label
                    key={t}
                    className={`${styles.option} ${active ? styles.optionActive : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleWorker(t)}
                    />
                    {t}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* 임금명세서 전용 — 계약 유형 단일 선택 (4옵션) */}
        {showWsContext && (
          <div className={styles.field}>
            <div className={styles.label}>계약 유형</div>
            <div className={styles.options}>
              {WS_CONTRACT_TYPES.map((t) => {
                const active = value.contractType === t;
                return (
                  <label
                    key={t}
                    className={`${styles.option} ${active ? styles.optionActive : ''}`}
                  >
                    <input
                      type="radio"
                      checked={active}
                      onChange={() => {
                        // contractType 단일 → workerTypes 단일 배열로 동기화
                        // (백엔드는 workerTypes 를 슬롯 분기에 그대로 사용)
                        patch({
                          contractType: t,
                          workerTypes: [t as WorkerType],
                        });
                      }}
                    />
                    {t}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── 섹션 1.5: 임금명세서 전용 — 산정기간 / 지급주기 / 근로시간 ── */}
      {showWsContext && (
        <>
          <div className={styles.divider} />
          <div className={styles.sectionTitle}>
            산정 대상 · 지급 조건
            <span className={styles.sectionHint}>
              · 최저임금·통상임금 기준 산정
            </span>
          </div>
          <div className={styles.grid}>
            <div className={styles.field}>
              <div className={styles.label}>
                <Term
                  def={
                    <>
                      해당 임금명세서가 어느 시점 임금에 대한 것인지 알려주세요.
                      최저임금은 매년 바뀌므로 (2024: 9,860원, 2025: 10,030원,
                      2026: 10,320원), 정확한 위반 여부 판단을 위해 필요합니다.
                    </>
                  }
                  hideDelay={500}
                  width={340}
                >
                  산정 대상 연도
                </Term>
              </div>
              <select
                value={value.payPeriodYear}
                onChange={(e) => patch({ payPeriodYear: Number(e.target.value) })}
                className={styles.select}
              >
                {[2026, 2025, 2024, 2023, 2022].map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <div className={styles.label}>산정 대상 월</div>
              <select
                value={value.payPeriodMonth}
                onChange={(e) => patch({ payPeriodMonth: Number(e.target.value) })}
                className={styles.select}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <div className={styles.label}>임금 지급 주기</div>
              <div className={styles.options}>
                {PAY_CYCLES.map((c) => {
                  const active = value.payCycle === c;
                  return (
                    <label
                      key={c}
                      className={`${styles.option} ${active ? styles.optionActive : ''}`}
                    >
                      <input
                        type="radio"
                        checked={active}
                        onChange={() => patch({ payCycle: c })}
                      />
                      {c}
                    </label>
                  );
                })}
              </div>
            </div>

            {value.contractType === '단시간' && (
              <div className={styles.field}>
                <div className={styles.label}>
                  주 소정근로시간
                  <span className={styles.sectionHint}>
                    · 시간 환산용 (40h 기준)
                  </span>
                </div>
                <input
                  type="number"
                  min={1}
                  max={68}
                  value={value.weeklyHours}
                  onChange={(e) =>
                    patch({ weeklyHours: Number(e.target.value) || 0 })
                  }
                  className={styles.numberInput}
                />
              </div>
            )}
          </div>
        </>
      )}

      {/* ── 섹션 2: 환경 (취업규칙 검사에서만) ── */}
      {showWorkEnv && (
        <>
          <div className={styles.divider} />
          <div className={styles.sectionTitle}>
            근로 환경
            <span className={styles.sectionHint}>· 취업규칙 검사에 사용</span>
          </div>
          <div className={styles.grid}>
            <RadioGroup
              label="교대근로 도입"
              tip={HELP_SHIFT}
              value={value.shiftWork}
              onChange={(v) => patch({ shiftWork: v })}
              options={[
                { value: 'unknown', label: '모름(검사함)' },
                { value: 'yes', label: '도입함' },
                { value: 'no', label: '미도입' },
              ]}
            />
            <div className={styles.field}>
              <div className={styles.label}>
                <Term def={HELP_OSHA} hideDelay={500} width={340}>
                  산업안전보건법 적용 업종
                </Term>
              </div>
              <label className={`${styles.checkBox} ${value.osh ? styles.checkBoxOn : ''}`}>
                <input
                  type="checkbox"
                  checked={value.osh}
                  onChange={(e) => patch({ osh: e.target.checked })}
                />
                해당 업종에 속함
              </label>
            </div>
            <RadioGroup
              label="화학물질 취급"
              tip={HELP_CHEM}
              value={value.chemicals}
              onChange={(v) => patch({ chemicals: v })}
              options={[
                { value: 'unknown', label: '모름(검사함)' },
                { value: 'yes', label: '취급함' },
                { value: 'no', label: '미취급' },
              ]}
            />
            <RadioGroup
              label="작업환경측정 대상"
              tip={HELP_WORKENV}
              value={value.envMonitor}
              onChange={(v) => patch({ envMonitor: v })}
              options={[
                { value: 'unknown', label: '모름(검사함)' },
                { value: 'yes', label: '대상' },
                { value: 'no', label: '비대상' },
              ]}
            />
          </div>
        </>
      )}
    </Card>
  );
}

export default WorkplaceForm;
