'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import SiteHeader from '@/components/layout/SiteHeader';
import { ChatAssistantBubble } from '@/components/review/ChatPanel';
import {
  formDownloadUrl,
  getDutiesBySize,
  getForms,
  getGlossary,
  getGuideItems,
  getGuideOverview,
  getOrgs,
  getRequiredDocs,
  getTimelineAll,
  postGuideChat,
  type FormTemplate,
  type GlossaryEntry,
  type GuideChatTurn,
  type GuideItem,
  type GuideOverview,
  type GovOrg,
  type ObligationTimeline,
  type RelatedFormHint,
  type RequiredDoc,
  type SizeDuty,
} from '@/lib/api/guide';

import styles from './page.module.css';

/**
 * 노무 가이드 라이브러리 — 영세사업주를 위한 꿀팁.
 *
 * 좌 사이드바: 카테고리 트리.
 * 우 본문: 선택 카테고리의 카드 리스트.
 *
 * 분쟁·진정·구제 신청 류는 백엔드 시드에서 제외돼 표시 안 됨.
 */

const SIZES = ['1인 이상', '5인 이상', '10인 이상', '30인 이상', '50인 이상'];


export default function GuidePage() {
  const [mounted, setMounted] = useState(false);
  const [overview, setOverview] = useState<GuideOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    getGuideOverview()
      .then(setOverview)
      .catch((e) => setError(e.message || '가이드 로드 실패'));
  }, []);

  if (!mounted) return <main className={styles.page} aria-hidden />;

  return (
    <main className={styles.page}>
      <SiteHeader />
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.eyebrow}>영세사업주를 위한 꿀팁</div>
          <h1 className={styles.title}>노무 가이드</h1>
          <p className={styles.subtitle}>
            자율점검에 도움되는 핵심 정보 — 의무 사항·서식·계산기·용어를 한 곳에.
          </p>
        </header>

        {error && (
          <div className={styles.errorBox}>
            <strong>로드 실패:</strong> {error}
          </div>
        )}

        <section className={styles.body}>
          <GuideChatTab overview={overview} />
        </section>

      </div>
    </main>
  );
}

// ─── 탭별 본문 ────────────────────────────────────────

/* ════════════════════════════════════════════════════════════════
 * GuideChatTab — 노무 가이드 챗봇 + 추천질문
 *
 * 가이드 DB(시기·규모별 의무·용어·기관·비치서류·라이프사이클·채용 컴플라이언스)을
 * 백엔드 키워드 매칭으로 컨텍스트 묶어 LLM 응답. 정리된 자료를 1차 근거로 사용.
 *
 * 추천 질문 = 사업주가 많이 묻는 12개 + 가이드 DB KPI 기반 (사용자가 클릭 한 번이면 질문).
 * ════════════════════════════════════════════════════════════════ */
const QUICK_QUESTIONS: { q: string; cat: string }[] = [
  { q: '5인 이상 사업장이 챙겨야 할 의무가 뭐예요?', cat: '의무' },
  { q: '취업규칙 신고는 어떻게 하나요?', cat: '의무' },
  { q: '근로계약서에 꼭 들어가야 할 항목은?', cat: '의무' },
  { q: '통상임금은 어떻게 판단해요?', cat: '용어' },
  { q: '통상임금과 평균임금 차이가 뭐예요?', cat: '용어' },
  { q: '주휴수당은 언제 발생하나요?', cat: '용어' },
  { q: '근로자 명부·임금대장 보존 기간은?', cat: '서류' },
  { q: '최저임금 미달 시 처벌은 어떻게 돼요?', cat: '의무' },
  { q: '직장 내 괴롭힘 신고 받으면 어떻게?', cat: '의무' },
  { q: '4대보험 가입 신고는 어디서 하나요?', cat: '기관' },
  { q: '근로계약 종료 시 사업주가 해야 할 절차는?', cat: '생애주기' },
  { q: '채용공고에 차별 표현 들어가면 처벌받나요?', cat: '채용' },
];

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  followUps?: string[];
  relatedForms?: RelatedFormHint[];
  clarify?: string | null;
}

type ChatMode = 'chat' | 'duties' | 'stages' | 'glossary' | 'orgs' | 'docs';
const CHAT_CATALOG_TABS: Array<{
  key: Exclude<ChatMode, 'chat'>;
  label: string;
  icon: string;
}> = [
  { key: 'duties', label: '의무', icon: '📋' },
  { key: 'glossary', label: '용어', icon: '📖' },
  { key: 'orgs', label: '기관', icon: '🏛' },
  { key: 'docs', label: '비치 서류', icon: '📂' },
];

/** 챗봇 의도 — 시작 화면(home)에서 사용자가 선택. */
type Intent = 'home' | 'form' | 'calc' | 'consult';

function GuideChatTab({ overview: _overview }: { overview: GuideOverview | null }) {
  const [mode, setMode] = useState<ChatMode>('chat');
  const [intent, setIntent] = useState<Intent>('home');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 서식 mode — 카테고리 + 양식 카드
  const [forms, setForms] = useState<FormTemplate[]>([]);
  const [formCategory, setFormCategory] = useState<string>('');

  // 계산 mode — 단계별 질문·답변
  type CalcKind = 'wage' | 'retire' | 'parental' | null;
  type CalcLine = {
    role: 'bot' | 'user';
    content: React.ReactNode;
    /** chip 으로 빠르게 답 선택 가능 시 옵션 라벨 */
    options?: { label: string; value: string }[];
  };
  const [calcKind, setCalcKind] = useState<CalcKind>(null);
  const [calcLines, setCalcLines] = useState<CalcLine[]>([]);
  const [calcSlots, setCalcSlots] = useState<Record<string, string>>({});
  const [calcInput, setCalcInput] = useState('');
  const calcListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (calcListRef.current) {
      calcListRef.current.scrollTop = calcListRef.current.scrollHeight;
    }
  }, [calcLines]);

  // ─── 계산 mode 헬퍼 함수 ─────────────────────────────
  const fmt = (n: number) => `${n.toLocaleString('ko-KR')}원`;

  /** 봇 질문 정의 (slot 키 + 질문 + 옵션 chip + 검증) */
  const CALC_FLOWS: Record<
    Exclude<CalcKind, null>,
    {
      title: string;
      steps: {
        slot: string;
        question: React.ReactNode;
        options?: { label: string; value: string }[];
        validate?: (v: string) => string | null; // 에러 메시지 또는 null
      }[];
      computeResult: (slots: Record<string, string>) => React.ReactNode;
    }
  > = {
    wage: {
      title: '💰 통상임금 계산',
      steps: [
        {
          slot: 'mode',
          question: '입력 방식을 선택해 주세요.',
          options: [
            { label: '월급으로 입력', value: 'monthly' },
            { label: '시급으로 입력', value: 'hourly' },
          ],
        },
        {
          slot: 'amount',
          question: (
            <>
              금액을 입력해 주세요. (정기상여금 제외 한 단위 금액)
              <br />
              <span style={{ fontSize: 11, color: 'var(--color-text-subtle)' }}>
                숫자만 입력 (예: 2500000)
              </span>
            </>
          ),
          validate: (v) =>
            /^[0-9,]+$/.test(v) && parseInt(v.replace(/,/g, ''), 10) > 0
              ? null
              : '숫자만 입력해 주세요',
        },
        {
          slot: 'dailyHours',
          question: '1일 소정근로시간은? (기본 8시간)',
          options: [
            { label: '8시간 (풀타임)', value: '8' },
            { label: '6시간', value: '6' },
            { label: '4시간', value: '4' },
          ],
          validate: (v) =>
            /^\d+(\.\d+)?$/.test(v) && parseFloat(v) > 0 && parseFloat(v) <= 24
              ? null
              : '0~24 범위 숫자',
        },
        {
          slot: 'weeklyHours',
          question: '1주 소정근로시간은? (기본 40시간)',
          options: [
            { label: '40시간 (풀타임)', value: '40' },
            { label: '30시간', value: '30' },
            { label: '20시간', value: '20' },
            { label: '15시간', value: '15' },
          ],
          validate: (v) =>
            /^\d+(\.\d+)?$/.test(v) && parseFloat(v) > 0 && parseFloat(v) <= 52
              ? null
              : '0~52 범위 숫자',
        },
        {
          slot: 'bonus',
          question: (
            <>
              정기상여금이 있다면 <strong>연간 총액</strong>을 입력해 주세요. 없으면 0.
            </>
          ),
          options: [{ label: '없음 (0원)', value: '0' }],
          validate: (v) =>
            /^[0-9,]+$/.test(v) && parseInt(v.replace(/,/g, ''), 10) >= 0
              ? null
              : '숫자만 입력',
        },
      ],
      computeResult: (s) => {
        const mode = s.mode;
        const amt = parseInt((s.amount || '0').replace(/,/g, ''), 10);
        const dH = parseFloat(s.dailyHours) || 8;
        const wH = parseFloat(s.weeklyHours) || 40;
        const bonus = parseInt((s.bonus || '0').replace(/,/g, ''), 10);
        // 통상 월급 = (입력 월급) + 연간 상여금/12, 또는 시급일 때 시급 × 209h + 보너스
        const monthlyOrdinary =
          (mode === 'hourly' ? amt * HOURS_PER_MONTH : amt) + bonus / 12;
        const hourly = Math.round(monthlyOrdinary / HOURS_PER_MONTH);
        const isBelowMin = hourly > 0 && hourly < MIN_HOURLY_2026;
        const overtime = Math.round(hourly * 1.5);
        const night = Math.round(hourly * 0.5);
        const holidayWithin = Math.round(hourly * 1.5);
        const holidayOver = Math.round(hourly * 2);
        const weeklyEligible = wH >= 15;
        const weeklyDaily = Math.min(8, wH / 5);
        const weekly = weeklyEligible ? Math.round(hourly * weeklyDaily) : 0;
        const annual = Math.round(hourly * dH);
        const severance = Math.round(hourly * dH * 30);
        const dailyWage = Math.round(hourly * dH);
        return (
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>
              ✅ 계산 결과
            </div>
            <div className={styles.calcResultRow}>
              <span>월 통상임금</span>
              <strong>{fmt(Math.round(monthlyOrdinary))}</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>통상시급 (÷209h)</span>
              <strong>{fmt(hourly)}</strong>
            </div>
            {isBelowMin && (
              <div className={styles.calcWarnInline}>
                ⚠️ 2026 최저시급 {MIN_HOURLY_2026.toLocaleString()}원 미달 — 차액{' '}
                {fmt(MIN_HOURLY_2026 - hourly)}/시간
              </div>
            )}
            <hr className={styles.calcResultDivider} />
            <div className={styles.calcResultRow}>
              <span>연장근로 (시간당)</span>
              <strong>{fmt(overtime)}</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>야간 가산 (시간당)</span>
              <strong>{fmt(night)}</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>휴일 8h 이내 (시간당)</span>
              <strong>{fmt(holidayWithin)}</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>휴일 8h 초과 (시간당)</span>
              <strong>{fmt(holidayOver)}</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>주휴수당 ({weeklyEligible ? `${weeklyDaily}h 기준` : '발생 없음'})</span>
              <strong>{weeklyEligible ? fmt(weekly) : '—'}</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>연차수당 ({dH}h 기준)</span>
              <strong>{fmt(annual)}</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>해고예고수당 (30일분)</span>
              <strong>{fmt(severance)}</strong>
            </div>
            <div className={styles.calcResultNote}>
              일 통상임금 {fmt(dailyWage)} 기준 · 정밀 계산은 위 🧮 계산기 탭에서 항목별 산입
              토글 가능
            </div>
          </div>
        );
      },
    },
    retire: {
      title: '📆 퇴직금 계산',
      steps: [
        {
          slot: 'hireDate',
          question: '입사일을 입력해 주세요. (예: 2020-03-01)',
          validate: (v) =>
            /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'YYYY-MM-DD 형식',
        },
        {
          slot: 'leaveDate',
          question: '퇴사일을 입력해 주세요. (예: 2026-05-31)',
          validate: (v) =>
            /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'YYYY-MM-DD 형식',
        },
        {
          slot: 'm1',
          question: '직전 3개월 임금 — 최근 -1개월 월 임금은? (숫자만)',
          validate: (v) =>
            /^[0-9,]+$/.test(v) && parseInt(v.replace(/,/g, ''), 10) > 0
              ? null
              : '숫자만 입력',
        },
        {
          slot: 'm2',
          question: '최근 -2개월 월 임금은? (숫자만)',
          validate: (v) =>
            /^[0-9,]+$/.test(v) && parseInt(v.replace(/,/g, ''), 10) > 0
              ? null
              : '숫자만 입력',
        },
        {
          slot: 'm3',
          question: '최근 -3개월 월 임금은? (숫자만)',
          validate: (v) =>
            /^[0-9,]+$/.test(v) && parseInt(v.replace(/,/g, ''), 10) > 0
              ? null
              : '숫자만 입력',
        },
        {
          slot: 'annualBonus',
          question: '연간 상여금이 있나요? 있으면 연 총액, 없으면 0',
          options: [{ label: '없음 (0원)', value: '0' }],
          validate: (v) =>
            /^[0-9,]+$/.test(v) && parseInt(v.replace(/,/g, ''), 10) >= 0
              ? null
              : '숫자만 입력',
        },
        {
          slot: 'annualLeavePay',
          question: '연간 미사용 연차수당이 있나요? 있으면 연 총액, 없으면 0',
          options: [{ label: '없음 (0원)', value: '0' }],
          validate: (v) =>
            /^[0-9,]+$/.test(v) && parseInt(v.replace(/,/g, ''), 10) >= 0
              ? null
              : '숫자만 입력',
        },
      ],
      computeResult: (s) => {
        const start = new Date(s.hireDate);
        const end = new Date(s.leaveDate);
        const totalDays = Math.floor((end.getTime() - start.getTime()) / 86400000);
        const years = totalDays / 365;
        if (totalDays < 365) {
          return (
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>
                ⚠️ 퇴직금 미발생
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.6 }}>
                계속근로 <strong>{totalDays}일 ({years.toFixed(2)}년)</strong> — 1년 미만은
                퇴직금 지급 의무 없음 (근로자퇴직급여보장법 제4조).
              </p>
            </div>
          );
        }
        const w1 = parseInt((s.m1 || '0').replace(/,/g, ''), 10);
        const w2 = parseInt((s.m2 || '0').replace(/,/g, ''), 10);
        const w3 = parseInt((s.m3 || '0').replace(/,/g, ''), 10);
        const bonus = parseInt((s.annualBonus || '0').replace(/,/g, ''), 10);
        const leave = parseInt((s.annualLeavePay || '0').replace(/,/g, ''), 10);
        const sum3 = w1 + w2 + w3;
        const days3 = 92;
        const avgDaily = (sum3 + (bonus * 3) / 12 + (leave * 3) / 12) / days3;
        const severance = Math.round(avgDaily * 30 * (totalDays / 365));
        return (
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>
              ✅ 계산 결과
            </div>
            <div className={styles.calcResultRow}>
              <span>계속근로</span>
              <strong>
                {totalDays}일 ({years.toFixed(2)}년)
              </strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>평균임금 (1일)</span>
              <strong>{fmt(Math.round(avgDaily))}</strong>
            </div>
            <hr className={styles.calcResultDivider} />
            <div className={styles.calcResultRow}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>예상 퇴직금</span>
              <strong style={{ fontSize: 18, color: 'var(--color-brand)' }}>
                {fmt(severance)}
              </strong>
            </div>
            <div className={styles.calcResultNote}>
              평균임금 × 30 × (계속근로일수 ÷ 365) · 근로자퇴직급여보장법 제8조
            </div>
          </div>
        );
      },
    },
    parental: {
      title: '👶 출산·육아 급여 계산',
      steps: [
        {
          slot: 'monthlyOrdinary',
          question: (
            <>
              <strong>월 통상임금</strong>을 입력해 주세요. (정기상여금 포함, 월 209h 기준)
              <br />
              <span style={{ fontSize: 11, color: 'var(--color-text-subtle)' }}>
                예: 2,500,000
              </span>
            </>
          ),
          validate: (v) =>
            /^[0-9,]+$/.test(v) && parseInt(v.replace(/,/g, ''), 10) > 0
              ? null
              : '숫자만 입력',
        },
        {
          slot: 'reducedHours',
          question: (
            <>
              <strong>육아기 단축 시간</strong> (주당)도 함께 계산할까요? 없으면 0.
            </>
          ),
          options: [
            { label: '필요 없음 (0)', value: '0' },
            { label: '주 5시간', value: '5' },
            { label: '주 10시간', value: '10' },
          ],
          validate: (v) =>
            /^\d+(\.\d+)?$/.test(v) && parseFloat(v) >= 0 && parseFloat(v) <= 40
              ? null
              : '0~40 범위',
        },
      ],
      computeResult: (s) => {
        const monthly = parseInt((s.monthlyOrdinary || '0').replace(/,/g, ''), 10);
        const hourly = Math.round(monthly / HOURS_PER_MONTH);
        const daily = Math.round((monthly / 209) * 8); // 8h 기준 일 통상임금
        const reducedH = parseFloat(s.reducedHours) || 0;
        const wH = 40;
        // 출산전후휴가
        const maternityDay = Math.min(daily, 70000);
        const maternity90 = maternityDay * 90;
        // 배우자
        const spouseDay = Math.min(daily, 100000);
        const spouse20 = spouseDay * 20;
        // 육아휴직 12개월 (구간별 상한)
        const cap = (n: number, ceil: number) => Math.min(n, ceil);
        const floor = (n: number) => Math.max(n, 700000);
        const p1 = floor(cap(monthly, 2500000));
        const p2 = floor(cap(monthly, 2000000));
        const p3 = floor(cap(Math.round(monthly * 0.8), 1600000));
        const total12 = p1 * 3 + p2 * 3 + p3 * 6;
        // 단축
        const h100 = Math.min(10, reducedH);
        const h80 = Math.max(0, reducedH - 10);
        const reduced100 = cap(Math.round((monthly * h100) / wH), 2200000);
        const reduced80 = cap(Math.round((monthly * h80 * 0.8) / wH), 1500000);
        const reducedMonthly = reduced100 + reduced80;
        return (
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8 }}>
              ✅ 계산 결과 (2025.1 개정 기준)
            </div>
            <div className={styles.calcResultRow}>
              <span>통상시급</span>
              <strong>{fmt(hourly)}</strong>
            </div>
            <hr className={styles.calcResultDivider} />
            <div className={styles.calcResultRow}>
              <span>🤰 출산전후휴가 (90일)</span>
              <strong>{fmt(maternity90)}</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>🤝 배우자 출산휴가 (20일)</span>
              <strong>{fmt(spouse20)}</strong>
            </div>
            <hr className={styles.calcResultDivider} />
            <div className={styles.calcResultRow}>
              <span>👶 육아휴직 1~3개월 (월)</span>
              <strong>{fmt(p1)}</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>👶 육아휴직 4~6개월 (월)</span>
              <strong>{fmt(p2)}</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span>👶 육아휴직 7~12개월 (월)</span>
              <strong>{fmt(p3)}</strong>
            </div>
            <div className={styles.calcResultRow}>
              <span style={{ fontWeight: 700 }}>12개월 총액</span>
              <strong style={{ color: 'var(--color-brand)' }}>{fmt(total12)}</strong>
            </div>
            {reducedH > 0 && (
              <>
                <hr className={styles.calcResultDivider} />
                <div className={styles.calcResultRow}>
                  <span>🕐 육아기 단축급여 ({reducedH}h/주, 월)</span>
                  <strong>{fmt(reducedMonthly)}</strong>
                </div>
              </>
            )}
            <div className={styles.calcResultNote}>
              상한·하한은 2025.1 개정 기준 — 정확한 금액은 고용보험 홈페이지 확인.
            </div>
          </div>
        );
      },
    },
  };

  const startCalc = (kind: Exclude<CalcKind, null>) => {
    setCalcKind(kind);
    setCalcSlots({});
    setCalcInput('');
    const flow = CALC_FLOWS[kind];
    setCalcLines([
      {
        role: 'bot',
        content: (
          <>
            <strong>{flow.title}</strong>을 시작합니다. 단계별로 답해주시면 자동으로 계산해
            드릴게요.
          </>
        ),
      },
      {
        role: 'bot',
        content: flow.steps[0].question,
        options: flow.steps[0].options,
      },
    ]);
  };

  const submitCalcAnswer = (value: string, displayLabel: string) => {
    if (!calcKind) return;
    const flow = CALC_FLOWS[calcKind];
    const stepIdx = Object.keys(calcSlots).filter((k) => !k.startsWith('_')).length;
    const step = flow.steps[stepIdx];
    if (!step) return;
    // 검증
    if (step.validate) {
      const err = step.validate(value);
      if (err) {
        setCalcLines((prev) => [
          ...prev,
          { role: 'user', content: displayLabel },
          { role: 'bot', content: `⚠️ ${err} — 다시 입력해 주세요.` },
          { role: 'bot', content: step.question, options: step.options },
        ]);
        setCalcInput('');
        return;
      }
    }
    const newSlots = { ...calcSlots, [step.slot]: value };
    setCalcSlots(newSlots);
    setCalcInput('');
    // 다음 단계 또는 결과
    const nextIdx = stepIdx + 1;
    if (nextIdx >= flow.steps.length) {
      // 완료 — 결과 계산
      setCalcLines((prev) => [
        ...prev,
        { role: 'user', content: displayLabel },
        { role: 'bot', content: flow.computeResult(newSlots) },
      ]);
      setCalcSlots({ ...newSlots, _done: '1' });
    } else {
      const nextStep = flow.steps[nextIdx];
      setCalcLines((prev) => [
        ...prev,
        { role: 'user', content: displayLabel },
        { role: 'bot', content: nextStep.question, options: nextStep.options },
      ]);
    }
  };

  useEffect(() => {
    if (intent === 'form' && forms.length === 0) {
      getForms()
        .then((r) => {
          // 우리 서버에서 직접 다운로드 가능한 양식만 노출
          setForms(r.items.filter((it) => it.has_local));
        })
        .catch(() => setForms([]));
    }
  }, [intent, forms.length]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') {
      // AI 답변 도착 — 답변의 '첫 부분'이 보이게 해당 말풍선 상단으로 스크롤.
      // (맨 아래로 내리면 긴 답변의 끝부터 보여 사용자가 거슬러 올라가야 함)
      const bubbles = list.querySelectorAll('[data-chat-msg]');
      const target = bubbles[bubbles.length - 1] as HTMLElement | undefined;
      if (target) {
        list.scrollTop = Math.max(0, target.offsetTop - 12);
        return;
      }
    }
    // 사용자가 질문을 보냈거나 로딩 중 — 기존처럼 맨 아래(입력 흐름 유지)
    list.scrollTop = list.scrollHeight;
  }, [messages, pending]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setErr(null);
    const next = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages(next);
    setInput('');
    setPending(true);
    try {
      const history: GuideChatTurn[] = next.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const out = await postGuideChat(trimmed, history);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: out.answer,
          sources: out.matched_sources,
          followUps: out.follow_ups,
          relatedForms: out.related_forms,
          clarify: out.clarify,
        },
      ]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  // 카탈로그 모드 — KPI pill 클릭 시 챗봇 숨기고 정리된 카탈로그 표시
  if (mode !== 'chat') {
    // 문서형 4탭 통합 레이아웃 (zip 명세 A안)
    return (
      <GuideDocLayout
        activeMode={mode}
        onChangeMode={setMode}
        onBack={() => setMode('chat')}
        onAskChatbot={(q) => {
          setMode('chat');
          setIntent('consult');
          void send(q);
        }}
      />
    );
  }

  // ─── 시작 화면 (intent === 'home') — A안 미니멀 랜딩 ──────────────
  if (intent === 'home') {
    const LANDING_PICKS = [
      '5인 이상 사업장이 챙겨야 할 의무가 뭐예요?',
      '주휴수당은 언제 발생하나요?',
      '근로계약서에 꼭 들어가야 할 항목은?',
      '통상임금과 평균임금 차이가 뭐예요?',
      '4대보험 가입 신고는 어디서 하나요?',
      '최저임금 미달 시 처벌은?',
    ];
    return (
      <div className={styles.chatLanding}>
        {/* 브랜드 아이콘 */}
        <div className={styles.chatLandingIcon} aria-hidden>
          <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 4 11.5 8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
          </svg>
        </div>

        {/* 제목 + 부제 */}
        <h1 className={styles.chatLandingTitle}>무엇이든 물어보세요, 사장님</h1>
        <p className={styles.chatLandingSubtitle}>
          노무·임금·4대보험까지, 영세사업장에 필요한 답을 정리해 드려요.
        </p>

        {/* 입력창 */}
        <form
          className={styles.chatLandingInputBox}
          onSubmit={(e) => {
            e.preventDefault();
            const text = input.trim();
            if (!text) return;
            setIntent('consult');
            void send(text);
          }}
        >
          <span className={styles.chatLandingInputIcon} aria-hidden>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
          </span>
          <input
            type="text"
            className={styles.chatLandingInput}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="궁금한 노무 질문을 입력하세요"
            autoFocus
          />
          <button
            type="submit"
            className={`${styles.chatLandingSubmit} ${input.trim() ? styles.chatLandingSubmitActive : ''}`}
            disabled={!input.trim()}
          >
            질문
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </form>

        {/* 추천 질문 칩 (6개) */}
        <div className={styles.chatLandingPickList}>
          {LANDING_PICKS.map((q) => (
            <button
              key={q}
              type="button"
              className={styles.chatLandingPick}
              onClick={() => {
                setIntent('consult');
                void send(q);
              }}
            >
              {q}
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          ))}
        </div>

        {/* 빠른 메뉴 (서식·계산·카탈로그) — 미니멀 하단 footer */}
        <div className={styles.chatLandingFooter}>
          <button type="button" className={styles.chatLandingFooterBtn} onClick={() => { setFormCategory(''); setIntent('form'); }}>📄 서식 받기</button>
          <button type="button" className={styles.chatLandingFooterBtn} onClick={() => setIntent('calc')}>🧮 계산 도움</button>
          <span className={styles.chatLandingFooterDot}>·</span>
          <button type="button" className={styles.chatLandingFooterLink} onClick={() => setMode('duties')}>의무</button>
          <button type="button" className={styles.chatLandingFooterLink} onClick={() => setMode('stages')}>단계별 의무</button>
          <button type="button" className={styles.chatLandingFooterLink} onClick={() => setMode('glossary')}>용어</button>
          <button type="button" className={styles.chatLandingFooterLink} onClick={() => setMode('orgs')}>기관</button>
          <button type="button" className={styles.chatLandingFooterLink} onClick={() => setMode('docs')}>비치 서류</button>
        </div>
      </div>
    );
  }

  // ─── 서식 mode (intent === 'form') ────────────────────────────────
  if (intent === 'form') {
    const byCategory: Record<string, FormTemplate[]> = {};
    for (const f of forms) {
      (byCategory[f.category] ||= []).push(f);
    }
    const categories = Object.keys(byCategory);
    const currentList = formCategory ? byCategory[formCategory] ?? [] : [];
    return (
      <div className={styles.chatTabWrap}>
        <div className={styles.intentHeader}>
          <button
            type="button"
            className={styles.intentBackBtn}
            onClick={() => setIntent('home')}
          >
            ← 처음으로
          </button>
          <h3 className={styles.intentHeaderTitle}>📄 어떤 서식이 필요하세요?</h3>
        </div>
        {forms.length === 0 ? (
          <div className={styles.placeholder}>양식 목록을 불러오는 중…</div>
        ) : (
          <>
            <div className={styles.intentChipRow}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`${styles.subTabBtn} ${formCategory === cat ? styles.subTabBtnActive : ''}`}
                  onClick={() => setFormCategory(cat)}
                >
                  {cat}
                  <span className={styles.subTabCount}>{byCategory[cat].length}</span>
                </button>
              ))}
            </div>
            {formCategory && currentList.length > 0 && (
              <ul className={styles.itemList} style={{ marginTop: 14 }}>
                {currentList.map((f) => (
                  <li key={f.code} className={styles.itemCard}>
                    <div className={styles.itemTitle}>{f.form_name}</div>
                    <p className={styles.itemDesc}>{f.purpose}</p>
                    <div className={styles.itemMeta}>
                      <span><strong>제출처:</strong> {f.submit_to}</span>
                      <span><strong>기한:</strong> {f.deadline}</span>
                    </div>
                    <a
                      href={formDownloadUrl(f.code)}
                      className={styles.linkBtn}
                      title={`${f.local_filename}${f.local_size ? ` (${Math.round(f.local_size / 1024)} KB)` : ''}`}
                    >
                      📥 양식 다운로드 (
                      {f.local_filename?.split('.').pop()?.toUpperCase() || '파일'})
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {!formCategory && (
              <p className={styles.placeholder}>
                위 카테고리를 선택하시면 해당 양식들을 바로 받을 수 있어요.
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  // ─── 계산 mode (intent === 'calc') ────────────────────────────────
  if (intent === 'calc') {
    return (
      <div className={styles.chatTabWrap}>
        <div className={styles.intentHeader}>
          <button
            type="button"
            className={styles.intentBackBtn}
            onClick={() => {
              setIntent('home');
              setCalcKind(null);
              setCalcLines([]);
              setCalcSlots({});
              setCalcInput('');
            }}
          >
            ← 처음으로
          </button>
          <h3 className={styles.intentHeaderTitle}>🧮 어떤 계산이 필요하세요?</h3>
        </div>

        {/* 종류 선택 */}
        {!calcKind && (
          <div className={styles.intentMenu}>
            <button
              type="button"
              className={styles.intentMenuBtn}
              onClick={() => startCalc('wage')}
            >
              <span className={styles.intentMenuEmoji}>💰</span>
              <span className={styles.intentMenuLabel}>통상임금</span>
              <span className={styles.intentMenuDesc}>
                통상시급 + 연장·야간·휴일·주휴·연차·해고예고 수당 한 번에
              </span>
            </button>
            <button
              type="button"
              className={styles.intentMenuBtn}
              onClick={() => startCalc('retire')}
            >
              <span className={styles.intentMenuEmoji}>📆</span>
              <span className={styles.intentMenuLabel}>퇴직금</span>
              <span className={styles.intentMenuDesc}>
                평균임금 × 30 × 근속연수 (입사일·퇴사일·3개월 임금)
              </span>
            </button>
            <button
              type="button"
              className={styles.intentMenuBtn}
              onClick={() => startCalc('parental')}
            >
              <span className={styles.intentMenuEmoji}>👶</span>
              <span className={styles.intentMenuLabel}>출산·육아 급여</span>
              <span className={styles.intentMenuDesc}>
                출산전후휴가·배우자 출산휴가·육아휴직·근로시간 단축
              </span>
            </button>
          </div>
        )}

        {/* 단계별 질문·답변 */}
        {calcKind && (
          <>
            <div className={styles.calcChatList} ref={calcListRef}>
              {calcLines.map((ln, i) => (
                <div
                  key={i}
                  className={`${styles.chatMsg} ${styles[`chatMsg_${ln.role === 'bot' ? 'assistant' : 'user'}`]}`}
                >
                  <div className={styles.chatBubble}>{ln.content}</div>
                </div>
              ))}
              {/* 마지막 봇 메시지 옵션 chip */}
              {(() => {
                const last = calcLines[calcLines.length - 1];
                if (!last || last.role !== 'bot' || !last.options) return null;
                return (
                  <div className={styles.calcOptionRow}>
                    {last.options.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={styles.chatFollowUpChip}
                        onClick={() => submitCalcAnswer(opt.value, opt.label)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
            {/* 자유 입력 (chip 없거나 추가 입력 가능) */}
            {(() => {
              const last = calcLines[calcLines.length - 1];
              const isAwaitingInput = last && last.role === 'bot' && !calcSlots._done;
              if (!isAwaitingInput) return null;
              return (
                <form
                  className={styles.chatInputRow}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!calcInput.trim()) return;
                    submitCalcAnswer(calcInput.trim(), calcInput.trim());
                  }}
                >
                  <input
                    type="text"
                    className={styles.chatInput}
                    value={calcInput}
                    onChange={(e) => setCalcInput(e.target.value)}
                    placeholder="답변을 입력하세요"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className={styles.chatSend}
                    disabled={!calcInput.trim()}
                  >
                    답변
                  </button>
                </form>
              );
            })()}
            {/* 완료 후 다시 계산 / 종류 변경 */}
            {calcSlots._done && (
              <div className={styles.calcDoneActions}>
                <button
                  type="button"
                  className={styles.intentBackBtn}
                  onClick={() => startCalc(calcKind)}
                >
                  🔁 다시 계산
                </button>
                <button
                  type="button"
                  className={styles.intentBackBtn}
                  onClick={() => {
                    setCalcKind(null);
                    setCalcLines([]);
                    setCalcSlots({});
                  }}
                >
                  📋 다른 계산
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ─── 상담 mode (intent === 'consult') ─────────────────────────────
  return (
    <div className={styles.chatTabWrap}>
      <div className={styles.intentHeader}>
        <button
          type="button"
          className={styles.intentBackBtn}
          onClick={() => {
            setIntent('home');
            setMessages([]);
          }}
        >
          ← 처음으로
        </button>
        <h3 className={styles.intentHeaderTitle}>💬 무엇이 궁금하세요?</h3>
      </div>

      {/* 추천 질문 — 빈 대화일 때만 */}
      {messages.length === 0 && (
        <div className={styles.chatIntro}>
          <p className={styles.chatIntroSubtitle}>
            사장님들이 많이 묻는 질문이에요. 클릭 한 번이면 답을 받아볼 수 있어요. 직접
            물어보셔도 됩니다.
          </p>
          <div className={styles.chatQuickGrid}>
            {QUICK_QUESTIONS.map((qq) => (
              <button
                key={qq.q}
                type="button"
                className={styles.chatQuickItem}
                onClick={() => void send(qq.q)}
                disabled={pending}
              >
                <span className={styles.chatQuickCat}>{qq.cat}</span>
                <span className={styles.chatQuickQ}>{qq.q}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 메시지 목록 */}
      {messages.length > 0 && (
        <div className={styles.chatMsgList} ref={listRef}>
          {messages.map((m, i) => {
            const isLast = i === messages.length - 1;
            const showFollowUps =
              !pending &&
              isLast &&
              m.role === 'assistant' &&
              m.followUps &&
              m.followUps.length > 0;
            return (
              <div key={i}>
                <div
                  data-chat-msg
                  className={`${styles.chatMsg} ${styles[`chatMsg_${m.role}`]}`}
                >
                  {m.role === 'assistant' ? (
                    <div className={styles.chatAssistantWrap}>
                      {/* ChatAssistantBubble: "관련 법령: ..." 줄을 자동으로 LawChip 으로 분리
                          (국가법령정보센터 새 탭 링크). 본문은 markdown **bold** 자동 강조. */}
                      <ChatAssistantBubble content={m.content} />
                      {m.sources && m.sources.length > 0 && (
                        <div className={styles.chatSources}>
                          <span className={styles.chatSourcesLabel}>참고 자료</span>
                          {m.sources.map((s) => (
                            <span key={s} className={styles.chatSourceChip}>
                              {s}
                            </span>
                          ))}
                        </div>
                      )}
                      {m.relatedForms && m.relatedForms.length > 0 && (
                        <div className={styles.chatFormsBox}>
                          <div className={styles.chatFormsHeader}>
                            <span className={styles.chatFormsIcon}>📥</span>
                            <span className={styles.chatFormsTitle}>관련 서식</span>
                          </div>
                          {m.clarify && (
                            <div className={styles.chatFormsClarify}>
                              {m.clarify}
                            </div>
                          )}
                          <div className={styles.chatFormsList}>
                            {m.relatedForms.map((f) => (
                              <a
                                key={f.code}
                                href={formDownloadUrl(f.code)}
                                className={styles.chatFormChip}
                                download
                                title={f.purpose || f.form_name}
                              >
                                <span className={styles.chatFormChipName}>
                                  {f.form_name}
                                </span>
                                <span className={styles.chatFormChipMeta}>
                                  {f.category}
                                  {f.has_local ? ' · 다운' : ' · 외부'}
                                </span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={styles.chatBubble}>{m.content}</div>
                  )}
                </div>
                {showFollowUps && (
                  <div className={styles.chatFollowUpsRow}>
                    <span className={styles.chatFollowUpsLabel}>
                      💡 이어서 물어볼만한 질문
                    </span>
                    <div className={styles.chatFollowUpsList}>
                      {m.followUps!.map((q) => (
                        <button
                          key={q}
                          type="button"
                          className={styles.chatFollowUpChip}
                          onClick={() => void send(q)}
                          disabled={pending}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {pending && (
            <div className={`${styles.chatMsg} ${styles.chatMsg_assistant}`}>
              <div className={`${styles.chatBubble} ${styles.chatBubbleTyping}`}>
                <span className={styles.chatTypingDot} />
                <span className={styles.chatTypingDot} />
                <span className={styles.chatTypingDot} />
              </div>
            </div>
          )}
        </div>
      )}

      {err && (
        <div className={styles.chatError}>
          <strong>오류:</strong> {err}
        </div>
      )}

      {/* 입력 폼 */}
      <form className={styles.chatInputRow} onSubmit={submit}>
        <input
          type="text"
          className={styles.chatInput}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="궁금한 노무 질문을 자유롭게 입력하세요 (예: 5인 이상 사업장 의무는?)"
          disabled={pending}
        />
        <button
          type="submit"
          className={styles.chatSend}
          disabled={pending || !input.trim()}
        >
          {pending ? '…' : '질문'}
        </button>
      </form>

      <div className={styles.chatDisclaimer}>
        ⚠️ AI 답변은 일반 참고용입니다. 정확한 법령 적용은 공인노무사 상담을 권장합니다.
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════
 * GuideDocLayout — 문서형 4탭 통합 (zip 명세 A안)
 *
 * 좌측 스티키 목차 + 우측 상세 패널. 의무 탭은 규모 셀렉터로 적용/미적용 구분.
 * 데이터는 우리 DB:
 *   의무 → size_threshold_duty (getDutiesBySize('50인 이상') 한 번에 32개)
 *   용어 → guide_glossary
 *   기관 → gov_org
 *   비치서류 → required_document
 * 액션 "관련 서식 받기": FORM_TITLE_TO_CODE 매칭 → 직접 다운로드 / 없으면 챗봇 폴백
 * ════════════════════════════════════════════════════════════════ */

type DocTabKey = '의무' | '단계' | '용어' | '기관' | '비치서류';
const DOC_TABS: { key: DocTabKey; label: string }[] = [
  { key: '의무', label: '의무사항' },
  { key: '단계', label: '단계별 의무' },
  { key: '용어', label: '용어' },
  { key: '기관', label: '관련기관' },
  { key: '비치서류', label: '비치 서류' },
];
const MODE_TO_DOCTAB: Record<Exclude<ChatMode, 'chat'>, DocTabKey> = {
  duties: '의무',
  stages: '단계',
  glossary: '용어',
  orgs: '기관',
  docs: '비치서류',
};
const DOCTAB_TO_MODE: Record<DocTabKey, Exclude<ChatMode, 'chat'>> = {
  의무: 'duties',
  단계: 'stages',
  용어: 'glossary',
  기관: 'orgs',
  비치서류: 'docs',
};
const DUTY_SIZES = [1, 5, 10, 30, 50] as const;

/** 의무 제목 또는 비치서류 제목 → form_template 코드 (있으면 직접 다운로드) */
const FORM_TITLE_TO_CODE: Record<string, string> = {
  // 의무
  '근로계약서 서면 작성·교부': 'FRM001',
  '임금명세서 교부': 'FRM031',
  '4대보험 가입': 'FRM006',
  '취업규칙 작성·신고': 'FRM029',
  // 비치서류
  근로계약서: 'FRM001',
  취업규칙: 'FRM029',
  '연소근로자 관련 서류': 'FRM004',
  '기간제·단시간 근로계약서': 'FRM002',
  임금대장: 'FRM031',
  '임금명세서(사본)': 'FRM031',
};

/** "1인 이상" → 1, "5인 이상" → 5 */
function parseMinSize(s: string): number {
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 999;
}

interface DocItem {
  // 공통
  code?: string;
  t: string; // 제목
  d: string; // 본문
  // 의무 (규모별)
  from?: number;
  law?: string;
  doc?: string;
  pen?: string;
  // 용어
  rel?: string;
  // 기관
  tag?: string;
  tel?: string;
  web?: string;
  // 비치서류
  keep?: string;
  // 단계별 의무
  stage?: string;
  deadline?: string;
  priority?: string;
}

function GuideDocLayout({
  activeMode,
  onChangeMode,
  onBack,
  onAskChatbot,
}: {
  activeMode: Exclude<ChatMode, 'chat'>;
  onChangeMode: (m: Exclude<ChatMode, 'chat'>) => void;
  onBack: () => void;
  onAskChatbot: (q: string) => void;
}) {
  const activeTab = MODE_TO_DOCTAB[activeMode];
  const [size, setSize] = useState<number>(5);
  const [sel, setSel] = useState<number>(0);
  const [duties, setDuties] = useState<DocItem[]>([]);
  const [stages, setStages] = useState<DocItem[]>([]);
  const [terms, setTerms] = useState<DocItem[]>([]);
  const [orgs, setOrgs] = useState<DocItem[]>([]);
  const [docs, setDocs] = useState<DocItem[]>([]);

  useEffect(() => {
    // 전체 32개 = 50인 이상 호출 시 SIZE_RANK 누적으로 다 포함됨
    getDutiesBySize('50인 이상')
      .then((r) =>
        setDuties(
          r.duties.map((x) => ({
            code: x.code,
            t: x.duty,
            d: x.description || '',
            from: parseMinSize(x.min_size),
            law: x.legal_basis,
            doc: x.related_docs,
            pen: '',
          })),
        ),
      )
      .catch(() => setDuties([]));
    getTimelineAll()
      .then((r) =>
        setStages(
          r.items.map((x) => ({
            code: x.code,
            t: x.duty,
            d: x.description || '',
            stage: x.stage,
            deadline: x.deadline || '',
            priority: x.priority || '',
            law: x.legal_basis,
            pen: x.penalty || '',
          })),
        ),
      )
      .catch(() => setStages([]));
    getGlossary()
      .then((r) =>
        setTerms(
          r.items.map((g) => ({
            code: g.code,
            t: g.term,
            d: g.full_def || g.short_def || '',
            rel: g.confusable_with || '',
          })),
        ),
      )
      .catch(() => setTerms([]));
    getOrgs()
      .then((r) =>
        setOrgs(
          r.items.map((o) => ({
            code: o.code,
            tag: o.org_class,
            t: o.org_name,
            d: o.duties || '',
            tel: o.phone || '',
            web: o.online_channel || '',
          })),
        ),
      )
      .catch(() => setOrgs([]));
    getRequiredDocs()
      .then((r) =>
        setDocs(
          r.items.map((d) => ({
            code: d.code,
            tag: d.classification,
            t: d.doc_name,
            d: d.description || '',
            keep: d.retention_period || '',
            law: d.legal_basis,
            pen: d.penalty || '',
          })),
        ),
      )
      .catch(() => setDocs([]));
  }, []);

  // 탭 전환 시 선택 초기화
  useEffect(() => {
    setSel(0);
  }, [activeTab]);

  const data: DocItem[] =
    activeTab === '의무'
      ? duties
      : activeTab === '단계'
        ? stages
        : activeTab === '용어'
          ? terms
          : activeTab === '기관'
            ? orgs
            : docs;
  const cur = data[sel];
  const appliedCount = duties.filter((o) => (o.from ?? 1) <= size).length;

  return (
    <div className={styles.docLayout}>
      <button
        type="button"
        className={styles.docBackBtn}
        onClick={onBack}
      >
        ← 챗봇으로
      </button>
      <div className={styles.docEyebrow}>영세사업주를 위한 꿀팁</div>
      <h1 className={styles.docTitle}>노무 가이드</h1>
      <p className={styles.docSubtitle}>
        자율점검에 필요한 의무·단계·용어·기관·서류를 한곳에서. 항목을 골라 자세히 살펴보세요.
      </p>

      {/* 탭 */}
      <div className={styles.docTabBar}>
        {DOC_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${styles.docTabBtn} ${activeTab === t.key ? styles.docTabBtnActive : ''}`}
            onClick={() => onChangeMode(DOCTAB_TO_MODE[t.key])}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 의무 탭 — 규모 셀렉터 */}
      {activeTab === '의무' && (
        <div className={styles.docSizePicker}>
          <div className={styles.docSizeLabel}>사업장 상시 근로자 수</div>
          <div className={styles.docSizeBtnRow}>
            {DUTY_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                className={`${styles.docSizeBtn} ${size === s ? styles.docSizeBtnActive : ''}`}
                onClick={() => setSize(s)}
              >
                {s}인 이상
              </button>
            ))}
          </div>
          <div className={styles.docSizeSummary}>
            <strong>{size}인 이상</strong> 사업장에는 총{' '}
            <strong>{appliedCount}개</strong>의 의무가 적용됩니다.
          </div>
        </div>
      )}

      {/* 2단 그리드: 좌 스티키 목차 + 우 상세 */}
      <div className={styles.docGrid}>
        {/* 좌측 목차 */}
        <div className={styles.docTocSticky}>
          {activeTab === '단계'
            ? renderStageToc(data, sel, setSel)
            : data.map((o, i) => {
                const applies = activeTab !== '의무' || (o.from ?? 1) <= size;
                const active = sel === i;
                return (
                  <button
                    key={o.code || i}
                    type="button"
                    className={`${styles.docTocItem} ${active ? styles.docTocItemActive : ''} ${!applies ? styles.docTocItemMuted : ''}`}
                    onClick={() => setSel(i)}
                  >
                    <span className={styles.docTocIcon}>
                      {applies ? '●' : '🔒'}
                    </span>
                    <span className={styles.docTocText}>{o.t}</span>
                    {activeTab === '의무' && !applies && (
                      <span className={styles.docTocSizeBadge}>{o.from}인~</span>
                    )}
                  </button>
                );
              })}
        </div>

        {/* 우측 상세 */}
        <div className={styles.docDetailCard}>
          {!cur && <div className={styles.placeholder}>로딩…</div>}
          {cur && activeTab === '의무' && (
            <DocDetailDuty o={cur} size={size} onAsk={onAskChatbot} />
          )}
          {cur && activeTab === '단계' && (
            <DocDetailStage o={cur} onAsk={onAskChatbot} />
          )}
          {cur && activeTab === '용어' && (
            <DocDetailTerm o={cur} idx={sel} onAsk={onAskChatbot} />
          )}
          {cur && activeTab === '기관' && <DocDetailOrg o={cur} idx={sel} />}
          {cur && activeTab === '비치서류' && (
            <DocDetailDoc o={cur} idx={sel} onAsk={onAskChatbot} />
          )}
        </div>
      </div>
    </div>
  );
}

/** 단계별 TOC — stage 별 그룹 헤더 + 항목 리스트 */
function renderStageToc(
  data: DocItem[],
  sel: number,
  setSel: (i: number) => void,
) {
  // stage 기준으로 그룹화 (원본 순서 유지)
  const groups: { stage: string; items: { o: DocItem; i: number }[] }[] = [];
  data.forEach((o, i) => {
    const s = o.stage || '기타';
    let g = groups.find((x) => x.stage === s);
    if (!g) {
      g = { stage: s, items: [] };
      groups.push(g);
    }
    g.items.push({ o, i });
  });
  return (
    <>
      {groups.map((g) => (
        <div key={g.stage} className={styles.docTocGroup}>
          <div className={styles.docTocGroupLabel}>{g.stage}</div>
          {g.items.map(({ o, i }) => {
            const active = sel === i;
            return (
              <button
                key={o.code || i}
                type="button"
                className={`${styles.docTocItem} ${active ? styles.docTocItemActive : ''}`}
                onClick={() => setSel(i)}
              >
                <span className={styles.docTocIcon}>●</span>
                <span className={styles.docTocText}>{o.t}</span>
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** 단계별 의무 상세 */
function DocDetailStage({
  o,
  onAsk,
}: {
  o: DocItem;
  onAsk: (q: string) => void;
}) {
  const formCode = FORM_TITLE_TO_CODE[o.t];
  const prio = (o.priority || '').toLowerCase();
  const prioBadgeCls = prio.includes('high') || prio.includes('상')
    ? styles.docBadgeDanger
    : prio.includes('mid') || prio.includes('중')
      ? styles.docBadgeWarn
      : styles.docBadgeMuted;
  return (
    <>
      <div className={styles.docDetailHead}>
        <span className={`${styles.docBadge} ${styles.docBadgeBrand}`}>
          📍 {o.stage}
        </span>
        {o.priority && (
          <span className={`${styles.docBadge} ${prioBadgeCls}`}>
            우선순위 · {o.priority}
          </span>
        )}
      </div>
      <h2 className={styles.docDetailTitle}>{o.t}</h2>
      <p className={styles.docDetailBody}>{o.d}</p>
      <div className={styles.docDetailMetaRows}>
        {o.deadline && <DocMetaRow k="기한" v={o.deadline} />}
        {o.law && <DocMetaRow k="법적 근거" v={o.law} />}
        {o.pen && <DocMetaRow k="위반 시" v={o.pen} danger />}
      </div>
      <DocActions
        formCode={formCode}
        onAsk={() => onAsk(`${o.stage} - ${o.t} 에 대해 알려주세요`)}
      />
    </>
  );
}

/** 의무 상세 */
function DocDetailDuty({
  o,
  size,
  onAsk,
}: {
  o: DocItem;
  size: number;
  onAsk: (q: string) => void;
}) {
  const applies = (o.from ?? 1) <= size;
  const formCode = FORM_TITLE_TO_CODE[o.t];
  return (
    <>
      <div className={styles.docDetailHead}>
        {applies ? (
          <span className={`${styles.docBadge} ${styles.docBadgeOk}`}>
            ✓ 우리 사업장 적용
          </span>
        ) : (
          <span className={`${styles.docBadge} ${styles.docBadgeMuted}`}>
            🔒 {o.from}인 이상부터 적용
          </span>
        )}
        <span className={styles.docDetailHeadMeta}>적용 기준 · {o.from}인 이상</span>
      </div>
      <h2 className={styles.docDetailTitle}>{o.t}</h2>
      <p className={styles.docDetailBody}>{o.d}</p>
      {!applies && (
        <div className={styles.docDetailNotApplies}>
          현재 선택한 <strong>{size}인 이상</strong>에는 해당하지 않아요. 상시 근로자가
          <strong> {o.from}명</strong> 이상이 되면 이 의무가 새로 생깁니다.
        </div>
      )}
      <div className={styles.docDetailMetaRows}>
        {o.law && <DocMetaRow k="법적 근거" v={o.law} />}
        {o.doc && <DocMetaRow k="관련 서류" v={o.doc} />}
        {o.pen && <DocMetaRow k="위반 시" v={o.pen} danger />}
      </div>
      <DocActions
        formCode={formCode}
        onAsk={() => onAsk(`${o.t} 에 대해 자세히 알려주세요`)}
      />
    </>
  );
}

/** 용어 상세 */
function DocDetailTerm({
  o,
  idx,
  onAsk,
}: {
  o: DocItem;
  idx: number;
  onAsk: (q: string) => void;
}) {
  return (
    <>
      <div className={styles.docDetailNumber}>
        {String(idx + 1).padStart(2, '0')}
      </div>
      <h2 className={styles.docDetailTitle}>{o.t}</h2>
      <p className={styles.docDetailBody}>{o.d}</p>
      {o.rel && (
        <div className={styles.docConfusable}>
          <div className={styles.docConfusableLabel}>헷갈리는 용어</div>
          <div className={styles.docConfusableText}>{o.rel}</div>
        </div>
      )}
      <button
        type="button"
        className={styles.docAskBtn}
        onClick={() => onAsk(`${o.t} 의 의미와 적용을 알려주세요`)}
      >
        이 용어를 챗봇에게 물어보기
      </button>
    </>
  );
}

/** 기관 상세 */
function DocDetailOrg({ o, idx }: { o: DocItem; idx: number }) {
  // 첫 URL 추출 (online_channel 이 콤마/공백 분리일 수 있음)
  const webUrl = (() => {
    const txt = o.web || '';
    const m = txt.match(/https?:\/\/[^\s,]+/);
    if (m) return m[0];
    // "moel.go.kr" 같은 도메인만 있는 경우
    const domMatch = txt.match(/[a-z0-9.-]+\.(?:go\.kr|or\.kr|com|net)/i);
    return domMatch ? `https://${domMatch[0]}` : '';
  })();
  return (
    <>
      <div className={styles.docDetailNumber}>
        {String(idx + 1).padStart(2, '0')}
        {o.tag ? ` · ${o.tag}` : ''}
      </div>
      <h2 className={styles.docDetailTitle}>{o.t}</h2>
      <p className={styles.docDetailBody}>{o.d}</p>
      <div className={styles.docDetailMetaRows}>
        {o.tel && (
          <div className={styles.docMetaRow}>
            <span className={styles.docMetaKey}>전화</span>
            <span className={styles.docMetaValueBrand}>📞 {o.tel}</span>
          </div>
        )}
        {o.web && (
          <div className={styles.docMetaRow}>
            <span className={styles.docMetaKey}>웹사이트</span>
            <span className={styles.docMetaValue}>🌐 {o.web}</span>
          </div>
        )}
      </div>
      {webUrl && (
        <a
          href={webUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.docPrimaryBtn}
        >
          홈페이지 바로가기 ↗
        </a>
      )}
    </>
  );
}

/** 비치서류 상세 */
function DocDetailDoc({
  o,
  idx,
  onAsk,
}: {
  o: DocItem;
  idx: number;
  onAsk: (q: string) => void;
}) {
  const formCode = FORM_TITLE_TO_CODE[o.t];
  return (
    <>
      <div className={styles.docDetailNumber}>
        {String(idx + 1).padStart(2, '0')}
        {o.tag ? ` · ${o.tag}` : ''}
      </div>
      <h2 className={styles.docDetailTitle}>{o.t}</h2>
      <p className={styles.docDetailBody}>{o.d}</p>
      <div className={styles.docDetailMetaRows}>
        {o.keep && <DocMetaRow k="보존 기간" v={o.keep} />}
        {o.law && <DocMetaRow k="법적 근거" v={o.law} />}
        {o.pen && <DocMetaRow k="위반 시" v={o.pen} danger />}
      </div>
      <DocActions
        formCode={formCode}
        onAsk={() => onAsk(`${o.t} 비치·관리 방법을 알려주세요`)}
      />
    </>
  );
}

function DocMetaRow({
  k,
  v,
  danger,
}: {
  k: string;
  v: string;
  danger?: boolean;
}) {
  return (
    <div className={styles.docMetaRow}>
      <span className={styles.docMetaKey}>{k}</span>
      <span className={danger ? styles.docMetaValueDanger : styles.docMetaValue}>
        {v}
      </span>
    </div>
  );
}

function DocActions({
  formCode,
  onAsk,
}: {
  formCode?: string;
  onAsk: () => void;
}) {
  return (
    <div className={styles.docActions}>
      {formCode && (
        <a
          href={formDownloadUrl(formCode)}
          className={styles.docPrimaryBtn}
          download
          title="우리 서버에서 직접 다운로드"
        >
          📥 관련 서식 받기
        </a>
      )}
      <button
        type="button"
        className={styles.docSecondaryBtn}
        onClick={onAsk}
      >
        💬 챗봇에게 물어보기
      </button>
    </div>
  );
}


function OverviewTab({ data }: { data: GuideOverview | null }) {
  if (!data) {
    return <div className={styles.placeholder}>로딩…</div>;
  }
  const cards: Array<{ label: string; n: number; emoji: string; desc: string }> = [
    { label: 'FAQ', n: data.guide_items, emoji: '❓', desc: '사업주가 막막한 영역' },
    { label: '시기별 의무', n: data.obligations, emoji: '⏰', desc: '사업개시·채용·근로 중·종료' },
    { label: '계산기', n: data.wage_formulas, emoji: '🧮', desc: '통상임금·퇴직금 자동 계산' },
    { label: '용어 사전', n: data.glossary, emoji: '📖', desc: '통상임금 vs 평균임금 등' },
    { label: '신청 서식', n: data.forms, emoji: '📄', desc: '사업주 작성·제출용만' },
    { label: '관할 기관', n: data.orgs, emoji: '🏛', desc: '4대보험·고용센터·노무사' },
    { label: '비치 서류', n: data.required_docs, emoji: '📚', desc: '법령상 의무 비치' },
    { label: '라이프사이클', n: data.lifecycle_steps, emoji: '🔄', desc: '채용부터 종료까지' },
  ];
  return (
    <div className={styles.cardGrid}>
      {cards.map((c) => (
        <div key={c.label} className={styles.kpiCard}>
          <div className={styles.kpiTop}>
            <span className={styles.kpiEmoji}>{c.emoji}</span>
            <span className={styles.kpiLabel}>{c.label}</span>
          </div>
          <div className={styles.kpiNum}>{c.n}</div>
          <div className={styles.kpiDesc}>{c.desc}</div>
        </div>
      ))}
    </div>
  );
}

function DutiesTab() {
  const [size, setSize] = useState('5인 이상');
  const [duties, setDuties] = useState<SizeDuty[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getDutiesBySize(size)
      .then((r) => setDuties(r.duties))
      .catch(() => setDuties([]))
      .finally(() => setLoading(false));
  }, [size]);

  return (
    <div>
      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>사업장 규모</span>
        <div className={styles.pillRow}>
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.pill} ${size === s ? styles.pillActive : ''}`}
              onClick={() => setSize(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className={styles.placeholder}>로딩…</div>
      ) : (
        <ul className={styles.itemList}>
          {duties.map((d) => (
            <li key={d.code} className={styles.itemCard}>
              <div className={styles.itemHead}>
                <span className={styles.itemBadge}>{d.min_size}</span>
                <span className={styles.itemTitle}>{d.duty}</span>
              </div>
              <p className={styles.itemDesc}>{d.description}</p>
              <div className={styles.itemMeta}>
                <span><strong>관련 서류:</strong> {d.related_docs || '—'}</span>
                <span><strong>법령:</strong> {d.legal_basis}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FormsTab() {
  const [items, setItems] = useState<FormTemplate[]>([]);
  const [activeCat, setActiveCat] = useState<string>('');

  useEffect(() => {
    getForms()
      .then((r) => {
        // 우리 서버에서 직접 다운로드 가능한 양식만 노출 (외부 redirect 양식은 제외)
        setItems(r.items.filter((it) => it.has_local));
      })
      .catch(() => setItems([]));
  }, []);

  const byCategory = useMemo(() => {
    const out: Record<string, FormTemplate[]> = {};
    for (const it of items) {
      (out[it.category] ||= []).push(it);
    }
    return out;
  }, [items]);

  const categories = useMemo(() => Object.keys(byCategory), [byCategory]);

  // 첫 카테고리를 기본 선택
  useEffect(() => {
    if (!activeCat && categories.length > 0) {
      setActiveCat(categories[0]);
    }
  }, [categories, activeCat]);

  if (items.length === 0) {
    return (
      <div className={styles.placeholder}>
        다운로드 가능한 양식이 없습니다.
      </div>
    );
  }

  const currentList = activeCat ? byCategory[activeCat] ?? [] : [];

  return (
    <div>
      <div className={styles.subTabBar}>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`${styles.subTabBtn} ${activeCat === cat ? styles.subTabBtnActive : ''}`}
            onClick={() => setActiveCat(cat)}
          >
            {cat}
            <span className={styles.subTabCount}>{byCategory[cat].length}</span>
          </button>
        ))}
      </div>

      <ul className={styles.itemList}>
        {currentList.map((f) => (
          <li key={f.code} className={styles.itemCard}>
            <div className={styles.itemTitle}>{f.form_name}</div>
            <p className={styles.itemDesc}>{f.purpose}</p>
            <div className={styles.itemMeta}>
              <span><strong>제출처:</strong> {f.submit_to}</span>
              <span><strong>기한:</strong> {f.deadline}</span>
            </div>
            <a
              href={formDownloadUrl(f.code)}
              className={styles.linkBtn}
              title={`${f.local_filename}${f.local_size ? ` (${Math.round(f.local_size / 1024)} KB)` : ''}`}
            >
              📥 양식 다운로드 (
              {f.local_filename?.split('.').pop()?.toUpperCase() || '파일'})
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
 * CalcTab — 통상임금 계산기 + 퇴직금 계산기
 *
 * 사용자가 통상임금(시급 또는 월급) 입력 → 연장·야간·휴일·주휴·연차·해고예고 수당이
 * 자동 계산되어 실시간으로 표시. 2026 최저임금(10,320원) 미달 시 경고.
 * 별도 퇴직금 계산기 — 입사·퇴사일 + 직전 3개월 임금 → 평균임금·퇴직금 자동 계산.
 * 화면 하단에 정적 공식 카탈로그(wage_calc_formula)도 함께 노출 — 사용자가 직접 검증 가능.
 * ════════════════════════════════════════════════════════════════ */

const MIN_HOURLY_2026 = 10320;
const HOURS_PER_MONTH = 209; // 주 40h × 4.345주 ≈ 209h (월 통상임금 환산 기준)

type CalcSubTab = 'wage' | 'retire';
const CALC_SUBTABS: Array<{ key: CalcSubTab; label: string; icon: string }> = [
  { key: 'wage', label: '통상임금 계산기', icon: '💰' },
  { key: 'retire', label: '퇴직금 계산기', icon: '📆' },
];

function CalcTab() {
  const [sub, setSub] = useState<CalcSubTab>('wage');
  return (
    <div>
      <div className={styles.subTabBar}>
        {CALC_SUBTABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${styles.subTabBtn} ${sub === t.key ? styles.subTabBtnActive : ''}`}
            onClick={() => setSub(t.key)}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'wage' && <WageCalculator />}
      {sub === 'retire' && <RetirementCalculator />}
    </div>
  );
}

/** 임금 항목 단위 — 고용노동부 통상임금계산기 형태. */
interface WageItem {
  id: string;
  label: string;
  amount: string; // 사용자 입력 (콤마 허용)
  period: 'month' | 'year'; // 월액 / 연액
  included: boolean; // 통상임금 산입 여부
  hint?: string; // 정기성·일률성 판단 도움말
}

const DEFAULT_WAGE_ITEMS: WageItem[] = [
  { id: 'base', label: '기본급', amount: '2156880', period: 'month', included: true,
    hint: '소정근로 대가 — 거의 항상 통상임금 산입' },
  { id: 'position', label: '직책수당', amount: '', period: 'month', included: true,
    hint: '직책에 따라 일률 지급 시 산입 (정기성·일률성 충족)' },
  { id: 'license', label: '자격수당', amount: '', period: 'month', included: true,
    hint: '자격증 소지자에게 정액 일률 지급 시 산입' },
  { id: 'tenure', label: '근속수당', amount: '', period: 'month', included: true,
    hint: '근속연수별 일률 지급 시 산입 (2024.12.19 판결로 조건 부가되어도 포함 명확화)' },
  { id: 'bonus', label: '정기상여금', amount: '', period: 'year', included: true,
    hint: '정기·일률 지급되면 산입. 재직조건이 붙어도 3요소 갖추면 통상임금 (2024.12.19 판결)' },
  { id: 'meal', label: '식대', amount: '200000', period: 'month', included: true,
    hint: '전 직원에게 정액 일률 지급 시 산입 (실비변상 X)' },
  { id: 'car', label: '차량유지비', amount: '', period: 'month', included: false,
    hint: '실비변상은 X. 정액 일률 지급이면 산입 가능' },
];

/** 임금 항목 ⓘ 호버 안내 — 브라우저 native title 대신 실제 React popover.
 *
 * native title 은 1초 지연 + 일부 환경(모바일·Linux)에서 안 뜨는 문제. 직접 popover 렌더.
 * hover (mouse enter/leave) + focus/blur 둘 다 지원 — 키보드 접근성. */
function WageItemHelpTip({ hint }: { hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={styles.wageItemHelpWrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      role="note"
      aria-label={hint}
    >
      <span className={styles.wageItemHelp} aria-hidden>ⓘ</span>
      {open && (
        <span className={styles.wageItemHelpTip} role="tooltip">
          {hint}
        </span>
      )}
    </span>
  );
}

/** 통상임금 계산기 — 항목별 입력 (고용노동부 공식 계산기 형태).
 *
 * 임금 항목을 기본급·각종 수당·정기상여금으로 분리해 각각 통상임금 산입 여부를 토글.
 * 월액/연액 주기 선택 → 월 합계 → 통상시급 자동 산출.
 * 1일·1주 소정근로시간을 별도 입력받아 단시간 근로자도 정확. */
function WageCalculator() {
  const [items, setItems] = useState<WageItem[]>(DEFAULT_WAGE_ITEMS);
  const [extraCount, setExtraCount] = useState(0);
  const [dailyHours, setDailyHours] = useState<string>('8');
  const [weeklyHours, setWeeklyHours] = useState<string>('40');

  const parseAmount = (s: string): number => {
    const n = parseInt((s || '').replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : 0;
  };

  const updateItem = (id: string, patch: Partial<WageItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const addItem = () => {
    const id = `extra-${extraCount + 1}`;
    setItems((prev) => [
      ...prev,
      {
        id,
        label: '',
        amount: '',
        period: 'month',
        included: true,
        hint: '항목명을 직접 입력하세요 (예: 위험수당, PC수당). 정기·일률 지급이면 산입.',
      },
    ]);
    setExtraCount((n) => n + 1);
  };

  // 월 환산 합계 + 통상포함 합계
  const totals = useMemo(() => {
    let totalMonthly = 0;
    let ordinaryMonthly = 0;
    for (const it of items) {
      const amt = parseAmount(it.amount);
      const monthly = it.period === 'year' ? amt / 12 : amt;
      totalMonthly += monthly;
      if (it.included) ordinaryMonthly += monthly;
    }
    return {
      totalMonthly: Math.round(totalMonthly),
      ordinaryMonthly: Math.round(ordinaryMonthly),
    };
  }, [items]);

  const monthlyWage = totals.ordinaryMonthly;
  const hourlyWage = monthlyWage > 0 ? Math.round(monthlyWage / HOURS_PER_MONTH) : 0;

  // 사용자 입력 소정근로시간 — 유효 범위 (1~24, 1~52)
  const dH = Math.max(0, Math.min(24, parseFloat(dailyHours) || 0));
  const wH = Math.max(0, Math.min(52, parseFloat(weeklyHours) || 0));

  // 파생 수당 — 사용자 입력 근로시간을 그대로 사용
  const calcs = useMemo(() => {
    const h = hourlyWage;
    // 주휴수당 — 단시간도 비례. 풀타임 8h × 통상시급, 단시간은 (주근로시간/40) × 8h × 통상시급
    //   = 통상시급 × min(8, weeklyHours/5).  주 15h 미만은 발생 없음.
    const weeklyEligible = wH >= 15;
    const weeklyHoursForPay = Math.min(8, wH / 5);
    return {
      hourly: h,
      overtime: Math.round(h * 1.5), // 연장근로수당 (시간당)
      night: Math.round(h * 0.5), // 야간근로 가산 (시간당, 22시~익일 06시)
      holidayWithin: Math.round(h * 1.5), // 휴일근로 8시간 이내 (시간당)
      holidayOver: Math.round(h * 2.0), // 휴일근로 8시간 초과 (시간당)
      weekly: weeklyEligible ? Math.round(h * weeklyHoursForPay) : 0, // 주휴수당
      weeklyEligible,
      weeklyHoursForPay,
      annual: Math.round(h * dH), // 연차수당 (1일분 = 통상시급 × 1일 소정근로시간)
      severanceNotice: Math.round(h * dH * 30), // 해고예고수당 (30일분)
      dailyWage: Math.round(h * dH), // 일 통상임금 (참고용)
    };
  }, [hourlyWage, dH, wH]);

  const isBelowMin = hourlyWage > 0 && hourlyWage < MIN_HOURLY_2026;

  const fmt = (n: number) => `${n.toLocaleString('ko-KR')}원`;

  return (
    <section className={styles.calcSection}>
      <h3 className={styles.calcTitle}>💰 통상임금 계산기</h3>
      <p className={styles.calcSubtitle}>
        <strong>통상시급은 모든 법정수당의 기준</strong>이에요. 통상시급(또는 월 통상임금)과
        소정근로시간만 입력하면 아래 수당이 한 번에 계산됩니다:
      </p>
      <ul className={styles.calcIntroList}>
        <li><strong>연장근로수당</strong> — 통상시급 × 1.5 (주 40시간 초과)</li>
        <li><strong>야간근로 가산</strong> — 통상시급 × 0.5 (22시~06시)</li>
        <li><strong>휴일근로수당</strong> — 통상시급 × 1.5 (8h 이내) / × 2.0 (8h 초과)</li>
        <li><strong>주휴수당</strong> — 1주 통상임금 ÷ 5 (주 15h 이상 + 만근 시)</li>
        <li><strong>연차수당</strong> — 통상시급 × 1일 소정근로시간 (미사용 연차 보상)</li>
        <li><strong>해고예고수당</strong> — 일 통상임금 × 30 (30일 전 예고 없이 해고 시)</li>
      </ul>
      <div className={styles.calcInfoBox}>
        ⚖️ <strong>2024.12.19 대법원 전원합의체 판결</strong> — 통상임금 판단에서{' '}
        <strong>&ldquo;고정성&rdquo; 요건이 폐기</strong>되었습니다. 현재는{' '}
        <strong>소정근로 대가성 · 정기성 · 일률성</strong> 3요소만 충족하면 통상임금에
        해당하며, 재직조건이나 근무일수 조건이 부가된 정기상여금·근속수당 등도 3요소를 갖추면
        포함됩니다. 통상임금 산정 시 누락된 항목이 없는지 재점검이 필요해요.
      </div>

      {/* 임금 항목별 입력 표 */}
      <div className={styles.wageItemTableWrap}>
        <div className={styles.wageItemTableHead}>
          <span className={styles.wageItemCol_name}>항목</span>
          <span className={styles.wageItemCol_amt}>금액 (원)</span>
          <span className={styles.wageItemCol_period}>주기</span>
          <span className={styles.wageItemCol_inc}>통상임금 산입</span>
          <span className={styles.wageItemCol_act}> </span>
        </div>
        {items.map((it) => (
          <div key={it.id} className={styles.wageItemRow}>
            <div className={styles.wageItemCol_name}>
              {it.id.startsWith('extra-') ? (
                <input
                  type="text"
                  className={styles.wageItemNameInput}
                  value={it.label}
                  onChange={(e) => updateItem(it.id, { label: e.target.value })}
                  placeholder="항목명"
                />
              ) : (
                <span className={styles.wageItemLabel}>
                  {it.label}
                  {it.hint && <WageItemHelpTip hint={it.hint} />}
                </span>
              )}
            </div>
            <div className={styles.wageItemCol_amt}>
              <input
                type="text"
                inputMode="numeric"
                className={styles.wageItemAmtInput}
                value={it.amount ? Number(it.amount.replace(/[^0-9]/g, '')).toLocaleString('ko-KR') : ''}
                onChange={(e) => updateItem(it.id, { amount: e.target.value.replace(/[^0-9]/g, '') })}
                placeholder="0"
              />
            </div>
            <div className={styles.wageItemCol_period}>
              <select
                className={styles.wageItemPeriodSelect}
                value={it.period}
                onChange={(e) => updateItem(it.id, { period: e.target.value as 'month' | 'year' })}
              >
                <option value="month">월</option>
                <option value="year">연</option>
              </select>
            </div>
            <div className={styles.wageItemCol_inc}>
              <label className={styles.wageItemCheckLabel}>
                <input
                  type="checkbox"
                  checked={it.included}
                  onChange={(e) => updateItem(it.id, { included: e.target.checked })}
                />
                <span>{it.included ? '포함' : '제외'}</span>
              </label>
            </div>
            <div className={styles.wageItemCol_act}>
              {it.id.startsWith('extra-') && (
                <button
                  type="button"
                  className={styles.wageItemRemove}
                  onClick={() => removeItem(it.id)}
                  aria-label="항목 삭제"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          className={styles.wageItemAddBtn}
          onClick={addItem}
        >
          + 임금 항목 추가
        </button>
      </div>

      {/* 소정근로시간 — 표 아래 */}
      <div className={styles.calcInputRow}>
        <label className={styles.calcInputLabel}>
          1일 소정근로시간
          <div className={styles.calcInputWrap}>
            <input
              type="text"
              inputMode="decimal"
              className={styles.calcInput}
              value={dailyHours}
              onChange={(e) => setDailyHours(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="8"
            />
            <span className={styles.calcInputUnit}>시간</span>
          </div>
          <span className={styles.calcInputHint}>풀타임 8h · 단시간이면 조정</span>
        </label>
        <label className={styles.calcInputLabel}>
          1주 소정근로시간
          <div className={styles.calcInputWrap}>
            <input
              type="text"
              inputMode="decimal"
              className={styles.calcInput}
              value={weeklyHours}
              onChange={(e) => setWeeklyHours(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="40"
            />
            <span className={styles.calcInputUnit}>시간</span>
          </div>
          <span className={styles.calcInputHint}>주휴수당 기준 (15h 미만 미발생)</span>
        </label>
      </div>

      {/* 통상시급 요약 + 최저임금 경고 */}
      {hourlyWage > 0 && (
        <div className={`${styles.calcSummary} ${isBelowMin ? styles.calcSummaryWarn : ''}`}>
          <div className={styles.calcSummaryRow}>
            <span className={styles.calcSummaryLabel}>월 통상임금</span>
            <span className={styles.calcSummaryValue}>{fmt(monthlyWage)}</span>
            <span className={styles.calcSummaryLabel}>통상시급 (÷209h)</span>
            <span className={styles.calcSummaryValue}>{fmt(hourlyWage)}</span>
            {totals.totalMonthly !== monthlyWage && (
              <>
                <span className={styles.calcSummaryLabel}>월 총임금 (참고)</span>
                <span className={styles.calcSummaryValue}>{fmt(totals.totalMonthly)}</span>
              </>
            )}
          </div>
          {isBelowMin && (
            <div className={styles.calcWarn}>
              ⚠️ <strong>2026 최저시급 10,320원 미달</strong> — 차액{' '}
              {fmt(MIN_HOURLY_2026 - hourlyWage)}/시간. 최저임금법 제6조 위반 가능성.
            </div>
          )}
        </div>
      )}

      {/* 자동 계산된 수당 그리드 */}
      {hourlyWage > 0 && (
        <div className={styles.calcGrid}>
          <CalcCard
            label="연장근로수당"
            badge="V003"
            unit="시간당"
            value={fmt(calcs.overtime)}
            note={`주 40시간 초과 근로 시. 5인 이상 사업장 적용 (근로기준법 제56조).`}
          />
          <CalcCard
            label="야간근로 가산수당"
            badge="V004"
            unit="시간당 가산"
            value={fmt(calcs.night)}
            note="22시~익일 06시 근로 시. 통상시급의 50% 가산."
          />
          <CalcCard
            label="휴일근로수당 (8h 이내)"
            badge="V005"
            unit="시간당"
            value={fmt(calcs.holidayWithin)}
            note="주휴일·법정공휴일 근로. 8시간까지."
          />
          <CalcCard
            label="휴일근로수당 (8h 초과)"
            badge="V005"
            unit="시간당"
            value={fmt(calcs.holidayOver)}
            note="휴일 8시간 초과 부분. 가산 100%."
          />
          <CalcCard
            label="주휴수당"
            badge="V006"
            unit={calcs.weeklyEligible ? `${calcs.weeklyHoursForPay}h 기준 (1주분)` : '발생 없음'}
            value={calcs.weeklyEligible ? fmt(calcs.weekly) : '—'}
            note={
              calcs.weeklyEligible
                ? `1주 소정근로시간 ${wH}h ÷ 5일 = 1일분 ${calcs.weeklyHoursForPay}h (최대 8h). 주 15h 이상 + 1주 만근 시.`
                : `주 15시간 미만은 주휴수당 미발생.`
            }
          />
          <CalcCard
            label="연차수당"
            badge=""
            unit={`${dH}h × 1일분`}
            value={fmt(calcs.annual)}
            note="미사용 연차 1일당 보상. 5인 이상 사업장 (근로기준법 제60조)."
          />
          <CalcCard
            label="해고예고수당"
            badge=""
            unit="30일분"
            value={fmt(calcs.severanceNotice)}
            note={`일 통상임금 ${fmt(calcs.dailyWage)} × 30일. 30일 전 예고 없이 해고 시.`}
          />
        </div>
      )}

      {/* 출산·육아 급여 자동 계산 (고용보험 지급, 통상임금 기반) */}
      {hourlyWage > 0 && (
        <ParentalBenefitsSection
          hourlyWage={hourlyWage}
          monthlyOrdinary={monthlyWage}
          dailyWage={calcs.dailyWage}
          weeklyHours={wH}
        />
      )}
    </section>
  );
}

/**
 * 출산·육아 급여 자동 계산 — 고용보험에서 지급, 모두 통상임금 기반.
 *
 * 산식 (2025년 1월 개정안 기준):
 *  - 출산전후휴가 급여: 통상임금 100% × 90일 (다태아 120일)
 *    · 우선지원대상기업: 90일 전액 고용보험. 대규모기업: 마지막 45일만 고용보험
 *    · 월 상한 약 210만원 (고용노동부 고시), 하한 최저임금
 *  - 배우자 출산휴가 급여: 통상임금 100% × 20일 (2025.2 시행, 10→20일 확대)
 *    · 우선지원대상기업만 고용보험 (5일분만 상한 적용)
 *  - 육아휴직 급여 (2025.1 개정, 6+6 부모육아휴직제 별도):
 *    · 1~3개월: 통상임금 100% (상한 월 250만원)
 *    · 4~6개월: 통상임금 100% (상한 월 200만원)
 *    · 7~12개월: 통상임금 80% (상한 월 160만원)
 *    · 하한 월 70만원
 *  - 육아기 근로시간 단축 급여:
 *    · 매주 10시간까지: 통상임금 100% × (단축시간/주소정근로시간) (상한 월 220만원)
 *    · 나머지: 통상임금 80% × (단축시간/주소정근로시간) (상한 월 150만원)
 *
 * 정확한 상한·하한은 매년 고용노동부 고시로 변경 — 표시값은 2025년 기준이며
 * 안내문에 고시 확인 안내 추가.
 */
const MATERNITY_CAP_DAILY = 70000; // 출산전후휴가 일 상한 (월 210만원 ÷ 30)
const SPOUSE_LEAVE_CAP_DAILY = 100000; // 배우자 출산휴가 일 상한 (2025 추정)
const PARENTAL_LEAVE_CAP_1_3 = 2500000; // 1~3개월 월 상한
const PARENTAL_LEAVE_CAP_4_6 = 2000000; // 4~6개월 월 상한
const PARENTAL_LEAVE_CAP_7_12 = 1600000; // 7~12개월 월 상한 (80% 구간)
const PARENTAL_LEAVE_MIN_MONTHLY = 700000; // 월 하한
const REDUCED_HOURS_CAP_100 = 2200000; // 단축 100% 구간 상한
const REDUCED_HOURS_CAP_80 = 1500000; // 단축 80% 구간 상한

function ParentalBenefitsSection({
  hourlyWage,
  monthlyOrdinary,
  dailyWage,
  weeklyHours,
}: {
  hourlyWage: number;
  monthlyOrdinary: number;
  dailyWage: number;
  weeklyHours: number;
}) {
  const [reducedWeeklyHours, setReducedWeeklyHours] = useState<string>('5');

  const fmt = (n: number) => `${n.toLocaleString('ko-KR')}원`;

  // 1) 출산전후휴가 급여 — 통상임금 100% × 일수, 일 상한 적용
  const maternityDay = Math.min(dailyWage, MATERNITY_CAP_DAILY);
  const maternity90 = maternityDay * 90;
  const maternity120 = maternityDay * 120;

  // 2) 배우자 출산휴가 급여 — 통상임금 100% × 20일
  const spouseDay = Math.min(dailyWage, SPOUSE_LEAVE_CAP_DAILY);
  const spouse20 = spouseDay * 20;

  // 3) 육아휴직 급여 — 구간별
  const cap = (n: number, ceil: number) => Math.min(n, ceil);
  const floor = (n: number) => Math.max(n, PARENTAL_LEAVE_MIN_MONTHLY);
  const parental_1_3_monthly = floor(cap(Math.round(monthlyOrdinary), PARENTAL_LEAVE_CAP_1_3));
  const parental_4_6_monthly = floor(cap(Math.round(monthlyOrdinary), PARENTAL_LEAVE_CAP_4_6));
  const parental_7_12_monthly = floor(cap(Math.round(monthlyOrdinary * 0.8), PARENTAL_LEAVE_CAP_7_12));
  const parentalTotal12 = parental_1_3_monthly * 3 + parental_4_6_monthly * 3 + parental_7_12_monthly * 6;

  // 4) 육아기 근로시간 단축 급여 — 단축 시간 비율 적용
  const reduced_h = Math.max(0, Math.min(40, parseFloat(reducedWeeklyHours) || 0));
  const wH = weeklyHours > 0 ? weeklyHours : 40;
  // 100% 구간: 매주 10시간까지의 단축
  const hours_100 = Math.min(10, reduced_h);
  const hours_80 = Math.max(0, reduced_h - 10);
  // 월 급여 비율로 환산
  const reduced_100 = cap(Math.round((monthlyOrdinary * hours_100) / wH), REDUCED_HOURS_CAP_100);
  const reduced_80 = cap(Math.round((monthlyOrdinary * hours_80 * 0.8) / wH), REDUCED_HOURS_CAP_80);
  const reducedMonthly = reduced_100 + reduced_80;

  return (
    <div className={styles.parentalSection}>
      <h4 className={styles.parentalTitle}>👶 출산·육아 급여 자동 계산</h4>
      <p className={styles.parentalSubtitle}>
        통상임금 입력값을 기준으로 고용보험 지급액을 자동 산정합니다. 상한·하한은{' '}
        <strong>2025년 1월 개정 기준</strong> — 정확한 금액은 고용보험 홈페이지·관할 고용센터에서
        확인하세요.
      </p>

      {/* 출산전후휴가 */}
      <div className={styles.parentalCard}>
        <div className={styles.parentalCardHead}>
          <span className={styles.parentalIcon}>🤰</span>
          <span className={styles.parentalCardLabel}>출산전후휴가 급여</span>
          <span className={styles.parentalCardLaw}>고용보험법 제75조</span>
        </div>
        <div className={styles.parentalCardRow}>
          <span className={styles.parentalCardSub}>90일 (단태아)</span>
          <span className={styles.parentalCardValue}>{fmt(maternity90)}</span>
        </div>
        <div className={styles.parentalCardRow}>
          <span className={styles.parentalCardSub}>120일 (다태아)</span>
          <span className={styles.parentalCardValue}>{fmt(maternity120)}</span>
        </div>
        <div className={styles.parentalCardNote}>
          통상임금 100% × 휴가일수. 일 상한 {MATERNITY_CAP_DAILY.toLocaleString()}원 적용 (실제
          반영: 일 {fmt(maternityDay)}). 우선지원대상기업: 90일 전액 고용보험 / 대규모기업: 마지막
          45일만 고용보험 (앞 45일은 사업주 부담).
        </div>
      </div>

      {/* 배우자 출산휴가 */}
      <div className={styles.parentalCard}>
        <div className={styles.parentalCardHead}>
          <span className={styles.parentalIcon}>🤝</span>
          <span className={styles.parentalCardLabel}>배우자 출산휴가 급여</span>
          <span className={styles.parentalCardLaw}>고용보험법 제75조의2</span>
        </div>
        <div className={styles.parentalCardRow}>
          <span className={styles.parentalCardSub}>20일 (2025.2 시행, 10→20일 확대)</span>
          <span className={styles.parentalCardValue}>{fmt(spouse20)}</span>
        </div>
        <div className={styles.parentalCardNote}>
          통상임금 100% × 20일. 우선지원대상기업만 고용보험에서 5일분 (상한 약{' '}
          {SPOUSE_LEAVE_CAP_DAILY.toLocaleString()}원/일) 지급, 나머지는 사업주 부담.
        </div>
      </div>

      {/* 육아휴직 급여 — 구간별 */}
      <div className={styles.parentalCard}>
        <div className={styles.parentalCardHead}>
          <span className={styles.parentalIcon}>👶</span>
          <span className={styles.parentalCardLabel}>육아휴직 급여 (최대 12개월)</span>
          <span className={styles.parentalCardLaw}>고용보험법 제70조</span>
        </div>
        <div className={styles.parentalCardRow}>
          <span className={styles.parentalCardSub}>1~3개월 (통상 100%, 상한 250만)</span>
          <span className={styles.parentalCardValue}>{fmt(parental_1_3_monthly)}/월</span>
        </div>
        <div className={styles.parentalCardRow}>
          <span className={styles.parentalCardSub}>4~6개월 (통상 100%, 상한 200만)</span>
          <span className={styles.parentalCardValue}>{fmt(parental_4_6_monthly)}/월</span>
        </div>
        <div className={styles.parentalCardRow}>
          <span className={styles.parentalCardSub}>7~12개월 (통상 80%, 상한 160만)</span>
          <span className={styles.parentalCardValue}>{fmt(parental_7_12_monthly)}/월</span>
        </div>
        <div className={styles.parentalCardRow_total}>
          <span className={styles.parentalCardSub}>12개월 총액 (만근 기준)</span>
          <span className={styles.parentalCardValueLg}>{fmt(parentalTotal12)}</span>
        </div>
        <div className={styles.parentalCardNote}>
          하한 월 {PARENTAL_LEAVE_MIN_MONTHLY.toLocaleString()}원 자동 적용. 별도{' '}
          <strong>6+6 부모육아휴직제</strong>: 같은 자녀에 대해 부모 모두 사용 시 첫 6개월간 상한
          상향 (1개월 200만 → 6개월 450만, 부모 합산).
        </div>
      </div>

      {/* 육아기 근로시간 단축 */}
      <div className={styles.parentalCard}>
        <div className={styles.parentalCardHead}>
          <span className={styles.parentalIcon}>🕐</span>
          <span className={styles.parentalCardLabel}>육아기 근로시간 단축 급여</span>
          <span className={styles.parentalCardLaw}>고용보험법 제73조의2</span>
        </div>
        <div className={styles.parentalCardInput}>
          <label className={styles.parentalCardInputLabel}>
            단축 시간 (주당)
            <div className={styles.calcInputWrap}>
              <input
                type="text"
                inputMode="decimal"
                className={styles.calcInput}
                value={reducedWeeklyHours}
                onChange={(e) => setReducedWeeklyHours(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="5"
              />
              <span className={styles.calcInputUnit}>시간/주</span>
            </div>
          </label>
        </div>
        <div className={styles.parentalCardRow}>
          <span className={styles.parentalCardSub}>
            매주 10h 이내 단축분 (통상 100%): {hours_100}h
          </span>
          <span className={styles.parentalCardValue}>{fmt(reduced_100)}/월</span>
        </div>
        {hours_80 > 0 && (
          <div className={styles.parentalCardRow}>
            <span className={styles.parentalCardSub}>
              10h 초과 단축분 (통상 80%): {hours_80}h
            </span>
            <span className={styles.parentalCardValue}>{fmt(reduced_80)}/월</span>
          </div>
        )}
        <div className={styles.parentalCardRow_total}>
          <span className={styles.parentalCardSub}>월 단축급여 합계</span>
          <span className={styles.parentalCardValueLg}>{fmt(reducedMonthly)}</span>
        </div>
        <div className={styles.parentalCardNote}>
          단축시간 비율을 통상임금에 적용. 100% 구간 상한 월 {(REDUCED_HOURS_CAP_100/10000).toLocaleString()}만 · 80% 구간 상한
          월 {(REDUCED_HOURS_CAP_80/10000).toLocaleString()}만. (근로자 입장 — 사업주는 임금 단축분만큼 부담)
        </div>
      </div>

      {/* 최저 시급 가독성 안내 */}
      <div className={styles.parentalFootnote}>
        ※ 통상시급 <strong>{fmt(hourlyWage)}</strong> 기준 자동 산출. 모든 급여는 통상임금이
        기준이라 위 통상임금 계산기에 정기상여금·근속수당 등이 누락되면 실제보다 적게 나옵니다.
      </div>
    </div>
  );
}

function CalcCard({
  label,
  badge,
  unit,
  value,
  note,
}: {
  label: string;
  badge?: string;
  unit: string;
  value: string;
  note: string;
}) {
  return (
    <div className={styles.calcCard}>
      <div className={styles.calcCardHead}>
        {badge && <span className={styles.violationChip}>{badge}</span>}
        <span className={styles.calcCardLabel}>{label}</span>
      </div>
      <div className={styles.calcCardUnit}>{unit}</div>
      <div className={styles.calcCardValue}>{value}</div>
      <div className={styles.calcCardNote}>{note}</div>
    </div>
  );
}

/** 퇴직금 계산기 — 입사·퇴사일 + 직전 3개월 임금 → 평균임금·퇴직금 자동 계산. */
function RetirementCalculator() {
  const [hireDate, setHireDate] = useState<string>('');
  const [leaveDate, setLeaveDate] = useState<string>('');
  const [m1, setM1] = useState<string>('');
  const [m2, setM2] = useState<string>('');
  const [m3, setM3] = useState<string>('');
  const [annualBonus, setAnnualBonus] = useState<string>('0');
  const [annualLeavePay, setAnnualLeavePay] = useState<string>('0');

  const result = useMemo(() => {
    if (!hireDate || !leaveDate) return null;
    const start = new Date(hireDate);
    const end = new Date(leaveDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    if (end < start) return null;

    const totalDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const years = totalDays / 365;

    if (totalDays < 365) {
      return {
        eligible: false,
        totalDays,
        years,
        message: '계속근로 1년 미만 — 퇴직금 지급 의무 없음 (근로자퇴직급여보장법 제4조)',
      };
    }

    const w1 = parseInt(m1.replace(/[^0-9]/g, ''), 10) || 0;
    const w2 = parseInt(m2.replace(/[^0-9]/g, ''), 10) || 0;
    const w3 = parseInt(m3.replace(/[^0-9]/g, ''), 10) || 0;
    const bonus = parseInt(annualBonus.replace(/[^0-9]/g, ''), 10) || 0;
    const leave = parseInt(annualLeavePay.replace(/[^0-9]/g, ''), 10) || 0;

    if (w1 + w2 + w3 === 0) return { eligible: true, totalDays, years, incomplete: true };

    // 직전 3개월의 임금 총액
    const sum3 = w1 + w2 + w3;
    // 직전 3개월 일수 — 단순화로 92일 사용 (실무는 정확한 달력일수)
    const days3 = 92;
    // 평균임금 (1일) = (3개월 임금 + 상여금×3/12 + 연차수당×3/12) ÷ 직전 3개월 일수
    const avgDaily = (sum3 + (bonus * 3) / 12 + (leave * 3) / 12) / days3;
    // 퇴직금 = 평균임금 × 30 × (계속근로일수 ÷ 365)
    const severance = Math.round(avgDaily * 30 * (totalDays / 365));

    return {
      eligible: true,
      totalDays,
      years,
      avgDaily: Math.round(avgDaily),
      severance,
    };
  }, [hireDate, leaveDate, m1, m2, m3, annualBonus, annualLeavePay]);

  const fmt = (n: number) => `${n.toLocaleString('ko-KR')}원`;

  return (
    <section className={styles.calcSection}>
      <h3 className={styles.calcTitle}>📆 퇴직금 계산기</h3>
      <p className={styles.calcSubtitle}>
        입사·퇴사일 + <strong>직전 3개월 임금</strong> 입력 시 평균임금과 퇴직금이 자동 계산
        됩니다. 근로자퇴직급여보장법 제8조 기준 (30일분 평균임금 × 근속연수).
      </p>

      <div className={styles.calcRetGrid}>
        <label className={styles.calcInputLabel}>
          입사일
          <input
            type="date"
            className={styles.calcInput}
            value={hireDate}
            onChange={(e) => setHireDate(e.target.value)}
          />
        </label>
        <label className={styles.calcInputLabel}>
          퇴사일
          <input
            type="date"
            className={styles.calcInput}
            value={leaveDate}
            onChange={(e) => setLeaveDate(e.target.value)}
          />
        </label>
        <label className={styles.calcInputLabel}>
          직전 3개월 임금 — 가장 최근 달부터
          <div className={styles.calcMonthRow}>
            {[
              { v: m1, set: setM1, p: '최근 -1개월' },
              { v: m2, set: setM2, p: '최근 -2개월' },
              { v: m3, set: setM3, p: '최근 -3개월' },
            ].map((x, i) => (
              <div key={i} className={styles.calcInputWrap}>
                <input
                  type="text"
                  inputMode="numeric"
                  className={styles.calcInput}
                  value={x.v}
                  onChange={(e) => x.set(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder={x.p}
                />
                <span className={styles.calcInputUnit}>원</span>
              </div>
            ))}
          </div>
        </label>
        <label className={styles.calcInputLabel}>
          연간 상여금 (있는 경우)
          <div className={styles.calcInputWrap}>
            <input
              type="text"
              inputMode="numeric"
              className={styles.calcInput}
              value={annualBonus}
              onChange={(e) => setAnnualBonus(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
            />
            <span className={styles.calcInputUnit}>원/연</span>
          </div>
        </label>
        <label className={styles.calcInputLabel}>
          연간 미사용 연차수당 (있는 경우)
          <div className={styles.calcInputWrap}>
            <input
              type="text"
              inputMode="numeric"
              className={styles.calcInput}
              value={annualLeavePay}
              onChange={(e) => setAnnualLeavePay(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
            />
            <span className={styles.calcInputUnit}>원/연</span>
          </div>
        </label>
      </div>

      {result && (
        <div className={styles.calcRetResult}>
          {!result.eligible ? (
            <div className={styles.calcWarn}>⚠️ {result.message}</div>
          ) : result.incomplete ? (
            <div className={styles.calcSummaryRow}>
              <span className={styles.calcSummaryLabel}>계속근로</span>
              <span className={styles.calcSummaryValue}>
                {result.totalDays}일 ({result.years.toFixed(2)}년)
              </span>
              <span className={styles.calcInputHint}>
                ↑ 직전 3개월 임금을 입력하면 평균임금·퇴직금이 자동 계산됩니다.
              </span>
            </div>
          ) : (
            <>
              <div className={styles.calcSummaryRow}>
                <span className={styles.calcSummaryLabel}>계속근로</span>
                <span className={styles.calcSummaryValue}>
                  {result.totalDays}일 ({result.years.toFixed(2)}년)
                </span>
                <span className={styles.calcSummaryLabel}>평균임금 (1일)</span>
                <span className={styles.calcSummaryValue}>{fmt(result.avgDaily ?? 0)}</span>
              </div>
              <div className={styles.calcRetTotal}>
                <span>예상 퇴직금</span>
                <span className={styles.calcRetTotalValue}>{fmt(result.severance ?? 0)}</span>
              </div>
              <div className={styles.calcCardNote}>
                근거: 평균임금 × 30 × (계속근로일수 ÷ 365) · 근로자퇴직급여보장법 제8조
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}


function GlossaryTab() {
  const [items, setItems] = useState<GlossaryEntry[]>([]);
  useEffect(() => {
    getGlossary().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  return (
    <ul className={styles.itemList}>
      {items.map((t) => (
        <li key={t.code} className={styles.itemCard}>
          <div className={styles.itemTitle}>{t.term}</div>
          <div className={styles.shortDef}>{t.short_def}</div>
          <div className={styles.fullDef}>{t.full_def}</div>
          {t.confusable_with && (
            <div className={styles.confusable}>
              <strong>헷갈리는 용어:</strong> {t.confusable_with}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function OrgsTab() {
  const [items, setItems] = useState<GovOrg[]>([]);
  useEffect(() => {
    getOrgs().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  return (
    <ul className={styles.itemList}>
      {items.map((o) => (
        <li key={o.code} className={styles.itemCard}>
          <div className={styles.itemHead}>
            <span className={styles.itemBadge}>{o.org_class}</span>
            <span className={styles.itemTitle}>{o.org_name}</span>
          </div>
          <p className={styles.itemDesc}>{o.duties}</p>
          <div className={styles.itemMeta}>
            <span><strong>📞</strong> {o.phone}</span>
            {o.online_channel && (
              <span><strong>🌐</strong> {o.online_channel}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function DocsTab() {
  const [items, setItems] = useState<RequiredDoc[]>([]);
  useEffect(() => {
    getRequiredDocs().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  const byClass = useMemo(() => {
    const out: Record<string, RequiredDoc[]> = {};
    for (const d of items) {
      (out[d.classification] ||= []).push(d);
    }
    return out;
  }, [items]);
  return (
    <div>
      {Object.entries(byClass).map(([cls, list]) => (
        <section key={cls} className={styles.subSection}>
          <h3 className={styles.subTitle}>{cls}</h3>
          <ul className={styles.itemList}>
            {list.map((d) => (
              <li key={d.code} className={styles.itemCard}>
                <div className={styles.itemTitle}>{d.doc_name}</div>
                <p className={styles.itemDesc}>{d.description}</p>
                <div className={styles.itemMeta}>
                  <span><strong>보존:</strong> {d.retention_period}</span>
                  <span><strong>법령:</strong> {d.legal_basis}</span>
                </div>
                {d.penalty && (
                  <div className={styles.penaltyChip}>⚠ {d.penalty}</div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function FaqTab() {
  const [items, setItems] = useState<GuideItem[]>([]);
  useEffect(() => {
    getGuideItems().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  const byCategory = useMemo(() => {
    const out: Record<string, GuideItem[]> = {};
    for (const it of items) {
      (out[it.category] ||= []).push(it);
    }
    return out;
  }, [items]);
  return (
    <div>
      {Object.entries(byCategory).map(([cat, list]) => (
        <section key={cat} className={styles.subSection}>
          <h3 className={styles.subTitle}>{cat}</h3>
          <ul className={styles.itemList}>
            {list.map((it) => (
              <li key={it.code} className={styles.itemCard}>
                <div className={styles.itemHead}>
                  {it.priority && (
                    <span className={`${styles.priorityChip} ${styles[`priority_${it.priority}`] ?? ''}`}>
                      우선순위 {it.priority}
                    </span>
                  )}
                  <span className={styles.itemTitle}>{it.title}</span>
                </div>
                {it.employer_reason && (
                  <p className={styles.itemDesc}><strong>사업주 입장:</strong> {it.employer_reason}</p>
                )}
                <p className={styles.itemKeypoints}>💡 {it.key_points}</p>
                <div className={styles.itemMeta}>
                  <span><strong>법령:</strong> {it.related_laws}</span>
                  {it.applies_under_5 && (
                    <span><strong>5인 미만:</strong> {it.applies_under_5}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
