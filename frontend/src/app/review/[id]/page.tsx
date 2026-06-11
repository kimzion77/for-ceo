'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import ChatPanel from '@/components/review/ChatPanel';
import DistributionCard from '@/components/review/DistributionCard';
import FilterBar, {
  type RiskFilter,
  type SortMode,
} from '@/components/review/FilterBar';
import FindingCarousel from '@/components/review/FindingCarousel';
import OptionalSection from '@/components/review/OptionalSection';
import PriorityCard from '@/components/review/PriorityCard';
import ResultHeader from '@/components/review/ResultHeader';
import VerdictCard from '@/components/review/VerdictCard';
import PrintLayout from '@/components/review/print/PrintLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import MobileReviewApp, {
  useIsMobileViewport,
  type MobileFinding,
} from '@/components/review/mobile/MobileReviewApp';

import { SAMPLE_RESULT } from '@/data/sample';
import { getCase } from '@/lib/reviewStore';
import { RISK_ORDER } from '@/styles/tokens';
import type { ReviewResult } from '@/types/review';

import styles from './page.module.css';

/**
 * 결과 대시보드 페이지.
 *
 * 시안 `screens-result.jsx` 의 사이드바 + 메인 2단 레이아웃을 이식.
 * 백엔드 연동 전이라 `SAMPLE_RESULT` mock 을 그대로 사용한다.
 * 추후 `GET /api/review/{id}` 호출 결과로 교체.
 */
export default function ReviewResultPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();

  // store 에서 실제 결과 로드. demo 또는 결과 없으면 SAMPLE_RESULT fallback.
  const [result, setResult] = useState<ReviewResult>(SAMPLE_RESULT);

  useEffect(() => {
    if (params.id === 'demo') return; // demo 는 항상 mock 사용
    const entry = getCase(params.id);
    if (!entry) return;
    // 근로계약서 풀 이식 — phase 에 따라 분기.
    if (entry.documentType === 'employment-contract' || entry.ec) {
      const phase = entry.ec?.phase;
      if (phase === 'review' || phase === 'extracting' || phase === 'structuring') {
        router.replace(`/review/${params.id}/ec/review`);
      } else if (phase === 'contract' && entry.ec?.generatedContract) {
        router.replace(`/review/${params.id}/ec/contract`);
      } else {
        router.replace(`/review/${params.id}/ec`);
      }
      return;
    }
    // 취업규칙 (기존 흐름)
    if (entry.status === 'done' && entry.result?.doc === 'work-rules') {
      setResult(entry.result.data);
    }
  }, [params.id, router]);

  const { summary, findings } = result;

  const [filter, setFilter] = useState<RiskFilter>('all');
  const [sort, setSort] = useState<SortMode>('risk');

  const filtered = useMemo(() => {
    let list = filter === 'all' ? findings : findings.filter((f) => f.risk === filter);
    if (sort === 'article') {
      list = [...list].sort((a, b) => a.article.localeCompare(b.article, 'ko'));
    } else {
      const order = new Map(RISK_ORDER.map((k, i) => [k, i]));
      list = [...list].sort(
        (a, b) => (order.get(a.risk) ?? 99) - (order.get(b.risk) ?? 99),
      );
    }
    return list;
  }, [findings, filter, sort]);

  const skippedCount = summary.counts.skipped ?? 0;

  const openFinding = (findingId: string) => {
    router.push(`/review/${params.id}/findings/${findingId}`);
  };

  // 인쇄 / PDF 다운로드 — 동일하게 window.print() 호출
  const handlePrint = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.print();
  }, []);

  // ─── 모바일 검토앱 (≤720px) — 공용 MobileReviewApp 으로 분기 ───
  const isMobile = useIsMobileViewport();
  // 문제 항목만 (적정 OK·추출실패 ERROR 제외).
  // tone — bucket 의미와 동일: 강행규정 미준수(VIOLATION·MISSING)=bad,
  // 임의규정·매칭모호(WARN·AMBIGUOUS)=warn.
  const mobileFindings = useMemo<MobileFinding[]>(
    () =>
      findings
        .filter(
          (f) =>
            f.status === 'VIOLATION' ||
            f.status === 'MISSING' ||
            f.status === 'AMBIGUOUS' ||
            f.status === 'WARN',
        )
        .map((f) => {
          // 벌칙 — 누락이면 미기재(omission) 쪽, 그 외엔 내용위반(violation) 쪽 우선.
          const pen = f.penalty
            ? f.status === 'MISSING'
              ? f.penalty.omission[0] ?? f.penalty.violation[0]
              : f.penalty.violation[0] ?? f.penalty.omission[0]
            : undefined;
          return {
            key: f.id,
            tone:
              f.status === 'VIOLATION' || f.status === 'MISSING'
                ? ('bad' as const)
                : ('warn' as const),
            name: `${f.article} ${f.articleTitle}`.trim() || f.title,
            reason: f.title,
            why: f.reason,
            law: f.laws?.[0]?.name,
            pen,
            now: f.quote || '(본문에 규정 없음)',
            fix: f.suggested,
          };
        }),
    [findings],
  );
  // 종합 판정 — verdictKey(가장 강한 버킷) 로 톤, 분포 카운트로 한줄 요약.
  const mobileVerdict = useMemo(() => {
    const c = summary.counts;
    const tone: 'bad' | 'warn' | 'ok' =
      summary.verdictKey === 'missing' || summary.verdictKey === 'violation'
        ? 'bad'
        : summary.verdictKey === 'ok'
          ? 'ok'
          : 'warn';
    const severeParts: string[] = [];
    if (c.missing) severeParts.push(`누락 ${c.missing}건`);
    if (c.violation) severeParts.push(`위반 ${c.violation}건`);
    const extraParts: string[] = [];
    if (c.warn) extraParts.push(`주의 ${c.warn}건`);
    if (c.ambiguous) extraParts.push(`검토필요 ${c.ambiguous}건`);
    let text: string;
    if (severeParts.length === 0 && extraParts.length === 0) {
      text = '법정 기준에 모두 부합합니다. 추가 시정 없이 운영 가능합니다.';
    } else if (severeParts.length === 0) {
      text = `강행규정 위반은 없으나, ${extraParts.join(', ')}의 점검 권장 항목이 있습니다.`;
    } else {
      text = `${severeParts.join(', ')}의 강행규정 미준수가 발견되어 시정이 필요합니다.`;
      if (extraParts.length > 0) {
        text += ` 이외 ${extraParts.join(', ')}도 함께 점검해 주세요.`;
      }
    }
    return { word: summary.verdict, tone, summary: text };
  }, [summary]);

  // ─── 모바일 — 결과 단계 전용 풀스크린 앱 (데스크톱 레이아웃 미렌더) ───
  // 취업규칙은 extractedText 가 store 에 없어 원문(doc) 화면 비활성. 영속화도 없음.
  if (isMobile) {
    return (
      <MobileReviewApp
        docLabel="취업규칙"
        filename={summary.fileName}
        verdict={mobileVerdict}
        findings={mobileFindings}
        okCount={summary.counts.ok ?? 0}
        onBack={() => router.push('/')}
      />
    );
  }

  return (
    <>
      {/* ── 화면용 ── */}
      <div className={`${styles.page} ${styles.screenOnly}`}>
        <SiteHeader />
        <ResultHeader summary={summary} onPrint={handlePrint} />

        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            <VerdictCard summary={summary} />
            <DistributionCard summary={summary} />
            <PriorityCard items={summary.topPriority} onOpenFinding={openFinding} />
          </aside>

          <main className={styles.main}>
            <FilterBar
              counts={summary.counts}
              filter={filter}
              onFilterChange={setFilter}
              sort={sort}
              onSortChange={setSort}
            />
            <FindingCarousel findings={filtered} onOpen={openFinding} />
            <OptionalSection count={skippedCount} />
          </main>
        </div>
      </div>

      {/* ── 인쇄용 (화면에서는 숨김) ── */}
      <PrintLayout summary={summary} findings={findings} />

      {/* 우하단 floating 챗봇 — SFR-001 (공용 컴포넌트) */}
      <div className="noPrint">
        <ChatPanel
          analysis={{
            doc: 'work_rules',
            summary,
            findings: findings.slice(0, 30).map((f) => ({
              id: f.id,
              article: f.article,
              articleTitle: f.articleTitle,
              risk: f.risk,
              title: f.title,
              reason: f.reason,
            })),
          }}
          docLabel="취업규칙"
          quickPrompts={[
            '필수 기재사항이 뭔가요?',
            '취업규칙 신고는 어디로 하나요?',
            '10인 이상 사업장 의무는 뭐예요?',
            '직장 내 괴롭힘은 어떻게 대응해요?',
          ]}
        />
      </div>
    </>
  );
}
