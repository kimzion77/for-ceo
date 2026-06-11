'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { postWsAnalyze } from '@/lib/api/ws';
import { ApiCallError } from '@/lib/api/client';
import { getCase, setCaseError, updateWs } from '@/lib/reviewStore';

import styles from './page.module.css';

/**
 * 임금명세서 — 추출 텍스트 확인·수정 페이지.
 *
 * 홈에서 /ws/extract 가 끝나면 ws.phase='review' 로 박히고 LoadingScreen 이 여기로 보낸다.
 * 사용자가 OCR 텍스트를 직접 고친 뒤 "분석 시작" → /ws/analyze 호출 (EC Step2 와 동일 패턴).
 * 모바일·데스크톱 공용 — 가운데 정렬 단일 칼럼 + 전체폭 textarea.
 */
export default function WsReviewPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const caseId = params.id;

  // SSR / client mount 간 hydration 일관성 — store 는 mount 후에만.
  const [mounted, setMounted] = useState(false);
  const [entry, setEntry] = useState<ReturnType<typeof getCase>>(null);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setMounted(true);
    const e = getCase(caseId);
    setEntry(e);
    if (e?.ws?.extractedText) setText(e.ws.extractedText);
  }, [caseId]);

  if (!mounted) {
    return <main className={styles.page} aria-hidden />;
  }

  // 케이스 없음 / 추출 텍스트 없음 — 새로고침으로 저장소가 비었거나 잘못된 URL.
  if (!entry || !entry.ws?.extractedText) {
    return (
      <main className={styles.page}>
        <div className={styles.container}>
          <div className={styles.notFound}>
            <h1 className={styles.title}>추출된 텍스트를 찾을 수 없습니다</h1>
            <p className={styles.notFoundDesc}>
              세션 ID <code className={styles.code}>{caseId}</code> 의 추출
              결과를 찾지 못했어요. 브라우저 저장소가 비워졌거나 다른 기기에서
              시작한 검토일 수 있습니다.
            </p>
            {entry?.ws?.errorMessage && (
              <p className={styles.notFoundError}>
                이전 오류: {entry.ws.errorMessage.slice(0, 200)}
              </p>
            )}
            <p>
              <Link href="/" className={styles.notFoundLink}>
                ← 새로 검토 시작하기
              </Link>
            </p>
          </div>
        </div>
      </main>
    );
  }

  const ws = entry.ws;

  const startAnalyze = () => {
    const edited = text;
    setSubmitting(true);
    // 수정 최종본을 store 에 저장 + phase='analyzing' → 즉시 로딩 페이지로.
    // LoadingScreen 이 ws.phase='result' 가 되면 결과 페이지로 라우팅한다.
    updateWs(caseId, {
      phase: 'analyzing',
      extractedText: edited,
      errorMessage: undefined,
    });
    router.push(`/review/${caseId}/loading`);
    // 백그라운드 fetch — 페이지 이탈 후에도 promise 는 살아있다.
    postWsAnalyze({
      wage_text: edited,
      business_size: ws.businessSize ?? '',
      worker_types: ws.workerTypes ?? [],
      pay_period_year: ws.payPeriodYear ?? undefined,
      pay_period_month: ws.payPeriodMonth ?? undefined,
      contract_type: ws.contractType ?? undefined,
      pay_cycle: ws.payCycle ?? undefined,
      weekly_hours: ws.weeklyHours ?? undefined,
    })
      .then((out) => {
        updateWs(caseId, {
          phase: 'result',
          analysisResult: out.analysis_result,
        });
      })
      .catch((err) => {
        const msg =
          err instanceof ApiCallError
            ? err.detail
            : err instanceof Error
              ? err.message
              : String(err);
        // setCaseError 는 entry 를 새로 만들며 ws 를 비우므로,
        // updateWs 패치에 텍스트·컨텍스트를 다시 실어 재시도 가능 상태를 보존.
        setCaseError(caseId, msg);
        updateWs(caseId, {
          phase: 'review',
          errorMessage: msg,
          extractedText: edited,
          businessSize: ws.businessSize,
          workerTypes: ws.workerTypes,
          payPeriodYear: ws.payPeriodYear,
          payPeriodMonth: ws.payPeriodMonth,
          contractType: ws.contractType,
          payCycle: ws.payCycle,
          weeklyHours: ws.weeklyHours,
        });
      });
  };

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>추출된 내용을 확인하고 수정해 주세요</h1>
        <p className={styles.subtitle}>
          명세서에서 <strong>잘못 읽힌 숫자·날짜·항목명</strong> 등을{' '}
          <strong>직접 고치면</strong> 분석이 <strong>더 정확</strong>해져요.
          수정이 끝나면 아래 <strong>&ldquo;분석 시작&rdquo;</strong>을 눌러
          주세요.
        </p>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>추출된 텍스트</span>
            {entry.originalFilename && (
              <span className={styles.cardFile} title={entry.originalFilename}>
                {entry.originalFilename}
              </span>
            )}
          </div>
          <textarea
            className={styles.textarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-label="추출된 임금명세서 텍스트"
          />
        </section>

        {ws.errorMessage && (
          <div className={styles.error}>
            <strong>분석 실패:</strong> {ws.errorMessage}
          </div>
        )}

        <div className={styles.ctaBar}>
          <Link href="/" className={styles.btnSecondary}>
            ← 처음으로
          </Link>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={startAnalyze}
            disabled={submitting}
          >
            {submitting ? '분석 준비 중…' : '분석 시작'}
          </button>
        </div>
      </div>
    </main>
  );
}
