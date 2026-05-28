'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import SiteHeader from '@/components/layout/SiteHeader';
import { renderBold } from '@/lib/markdownBold';
import {
  formDownloadUrl,
  getDutiesBySize,
  getForms,
  getGlossary,
  getGuideItems,
  getGuideOverview,
  getOrgs,
  getRequiredDocs,
  postGuideChat,
  type FormTemplate,
  type GlossaryEntry,
  type GuideChatTurn,
  type GuideItem,
  type GuideOverview,
  type GovOrg,
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

type Tab =
  | 'chat'     // 챗봇 — 의무·용어·기관·서류·라이프사이클·채용 통합 질문
  | 'calc'     // 임금 계산기 (interactive)
  | 'forms';   // 신청 서식 (다운로드)

const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: 'chat', label: '노무 챗봇', icon: '💬' },
  { key: 'calc', label: '계산기', icon: '🧮' },
  { key: 'forms', label: '서식', icon: '📄' },
];

const SIZES = ['1인 이상', '5인 이상', '10인 이상', '30인 이상', '50인 이상'];


export default function GuidePage() {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>('chat');
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

        <nav className={styles.tabBar} role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`${styles.tabBtn} ${tab === t.key ? styles.tabBtnActive : ''}`}
              onClick={() => setTab(t.key)}
            >
              <span className={styles.tabIcon}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        <section className={styles.body}>
          {tab === 'chat' && <GuideChatTab overview={overview} />}
          {tab === 'calc' && <CalcTab />}
          {tab === 'forms' && <FormsTab />}
        </section>

        <footer className={styles.footer}>
          💡 이 가이드는 자율점검에 도움이 되는 정보만 제공합니다. 분쟁·신고·구제 신청 안내는
          포함되지 않으며, 그런 절차가 필요하면 노무사 또는 변호사에게 문의하세요.
        </footer>
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
}

type ChatMode = 'chat' | 'duties' | 'glossary' | 'orgs' | 'docs';
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

function GuideChatTab({ overview }: { overview: GuideOverview | null }) {
  const [mode, setMode] = useState<ChatMode>('chat');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
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
    return (
      <div className={styles.chatTabWrap}>
        <div className={styles.subTabBar}>
          <button
            type="button"
            className={`${styles.subTabBtn} ${styles.subTabBtnBack}`}
            onClick={() => setMode('chat')}
          >
            ← 챗봇으로
          </button>
          {CHAT_CATALOG_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`${styles.subTabBtn} ${mode === t.key ? styles.subTabBtnActive : ''}`}
              onClick={() => setMode(t.key)}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
        {mode === 'duties' && <DutiesTab />}
        {mode === 'glossary' && <GlossaryTab />}
        {mode === 'orgs' && <OrgsTab />}
        {mode === 'docs' && <DocsTab />}
      </div>
    );
  }

  return (
    <div className={styles.chatTabWrap}>
      {/* 추천 질문 — 빈 대화 또는 항상 표시 */}
      {messages.length === 0 && (
        <div className={styles.chatIntro}>
          <h3 className={styles.chatIntroTitle}>무엇이 궁금하세요?</h3>
          <p className={styles.chatIntroSubtitle}>
            사장님들이 많이 묻는 질문이에요. 클릭 한 번이면 답을 받아볼 수 있어요. 직접
            물어보셔도 됩니다.
          </p>
          <p className={styles.chatIntroSubtitle}>
            정리된 자료를 직접 보고 싶다면 아래 카탈로그 카드를 누르세요.
          </p>
          <div className={styles.chatKpiRow}>
            <button
              type="button"
              className={styles.chatKpiPillBtn}
              onClick={() => setMode('duties')}
              title="시기·규모별 의무 목록 보기"
            >
              📋 의무
            </button>
            <button
              type="button"
              className={styles.chatKpiPillBtn}
              onClick={() => setMode('glossary')}
              title="노무 용어 사전 보기"
            >
              📖 용어
            </button>
            <button
              type="button"
              className={styles.chatKpiPillBtn}
              onClick={() => setMode('orgs')}
              title="관할 기관 안내 보기"
            >
              🏛 기관
            </button>
            <button
              type="button"
              className={styles.chatKpiPillBtn}
              onClick={() => setMode('docs')}
              title="법령상 비치·보존 서류 보기"
            >
              📂 비치 서류
            </button>
          </div>
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
                <div className={`${styles.chatMsg} ${styles[`chatMsg_${m.role}`]}`}>
                  <div className={styles.chatBubble}>
                    {m.role === 'assistant' ? renderBold(m.content) : m.content}
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
                  </div>
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
  useEffect(() => {
    getForms().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);
  const byCategory = useMemo(() => {
    const out: Record<string, FormTemplate[]> = {};
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
            {list.map((f) => (
              <li key={f.code} className={styles.itemCard}>
                <div className={styles.itemTitle}>{f.form_name}</div>
                <p className={styles.itemDesc}>{f.purpose}</p>
                <div className={styles.itemMeta}>
                  <span><strong>제출처:</strong> {f.submit_to}</span>
                  <span><strong>기한:</strong> {f.deadline}</span>
                </div>
                {/* 1순위: 로컬 파일 보유 → 우리 서버에서 직접 다운로드 (정확한 MIME).
                    2순위: 외부 URL 만 있으면 백엔드가 해당 URL 로 302 redirect — 같은
                    엔드포인트 클릭만으로 사용자는 정부 사이트로 자연스럽게 이동. */}
                {(f.has_local || f.download_url) && (
                  <a
                    href={formDownloadUrl(f.code)}
                    {...(!f.has_local && {
                      target: '_blank',
                      rel: 'noopener noreferrer',
                    })}
                    className={styles.linkBtn}
                    title={
                      f.has_local
                        ? `${f.local_filename}${f.local_size ? ` (${Math.round(f.local_size / 1024)} KB)` : ''} — 우리 서버에서 직접 다운로드`
                        : '고용노동부 공식 자료실에서 보기'
                    }
                  >
                    {f.has_local
                      ? `📥 양식 다운로드 (${f.local_filename?.split('.').pop()?.toUpperCase() || '파일'})`
                      : '🔗 고용노동부 공식 양식 ↗'}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
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
                  {it.hint && (
                    <span className={styles.wageItemHelp} title={it.hint}>ⓘ</span>
                  )}
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
