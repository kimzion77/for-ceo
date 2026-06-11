'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import MobileOcrConfirm from '@/components/review/mobile/MobileOcrConfirm';
import { useIsMobileViewport } from '@/components/review/mobile/MobileReviewApp';
import { postReviewWorkRules } from '@/lib/api/review';
import { ApiCallError } from '@/lib/api/client';
import {
  getCase,
  setCaseError,
  setCaseResult,
  updateWr,
} from '@/lib/reviewStore';
import type { WorkplaceContext } from '@/types/review';

import styles from './page.module.css';

/**
 * 취업규칙 — 추출 텍스트 확인·수정 페이지.
 *
 * 홈에서 postEcExtract (범용 parse_to_text) 가 끝나면 wr.phase='review' 로 박히고
 * LoadingScreen 이 여기로 보낸다. 사용자가 텍스트를 고친 뒤 "분석 시작" →
 * 수정본을 .txt File 로 감싸 기존 postReviewWorkRules 단일 호출에 그대로 태운다.
 * 성공 시 setCaseResult (status='done') → 기존 결과 페이지(/review/[id]) 라우팅.
 */
export default function WrReviewPage({ params }: { params: { id: string } }) {
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
    if (e?.wr?.extractedText) setText(e.wr.extractedText);
  }, [caseId]);

  // 모바일(≤720px) — 줄 단위 OCR 확인 화면으로 분기 (훅은 조기 return 전에)
  const isMobile = useIsMobileViewport();

  if (!mounted) {
    return <main className={styles.page} aria-hidden />;
  }

  // 케이스 없음 / 추출 텍스트 없음 — 새로고침으로 저장소가 비었거나 잘못된 URL.
  if (!entry || !entry.wr?.extractedText) {
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
            {entry?.wr?.errorMessage && (
              <p className={styles.notFoundError}>
                이전 오류: {entry.wr.errorMessage.slice(0, 200)}
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

  const wr = entry.wr;

  // 홈 폼 컨텍스트가 유실된 극단 케이스(다른 기기 복원 등) — 보수적 기본값.
  const FALLBACK_CONTEXT: WorkplaceContext = {
    shiftWorkUsed: null,
    oshaApplicable: true,
    chemicalHandling: null,
    workenvMeasurement: null,
    businessSize: null,
    workerTypes: [],
  };

  // 모바일·데스크톱이 동일 분석 흐름을 공유 — 수정 최종본만 인자로 받음.
  const startAnalyzeWith = (edited: string) => {
    const context = wr.context ?? FALLBACK_CONTEXT;
    setSubmitting(true);
    // phase='analyzing' → 즉시 로딩 페이지로. LoadingScreen 은 wr 'analyzing' 을
    // 라우팅하지 않고, setCaseResult 의 status='done' 으로 결과 페이지에 도달한다.
    updateWr(caseId, {
      phase: 'analyzing',
      extractedText: edited,
      errorMessage: undefined,
    });
    router.push(`/review/${caseId}/loading`);
    // 수정 텍스트를 .txt 파일로 감싸 기존 단일 호출 엔드포인트에 그대로 태움.
    const baseName = (entry.originalFilename || '문서').replace(/\.[^.]+$/, '');
    const txtFile = new File([edited], `${baseName}.txt`, {
      type: 'text/plain',
    });
    // 백그라운드 fetch — 페이지 이탈 후에도 promise 는 살아있다.
    postReviewWorkRules({
      files: [txtFile],
      context,
      documentType: 'work-rules',
    })
      .then((result) => {
        setCaseResult(caseId, result);
      })
      .catch((err) => {
        const msg =
          err instanceof ApiCallError
            ? err.detail
            : err instanceof Error
              ? err.message
              : String(err);
        // setCaseError 는 entry 를 새로 만들며 wr 를 비우므로,
        // updateWr 패치에 텍스트·컨텍스트를 다시 실어 재시도 가능 상태를 보존.
        setCaseError(caseId, msg);
        updateWr(caseId, {
          phase: 'review',
          errorMessage: msg,
          extractedText: edited,
          context,
        });
      });
  };

  const startAnalyze = () => startAnalyzeWith(text);

  // ── 모바일 (≤720px) — 줄 단위 OCR 확인 화면 ──
  if (isMobile) {
    return (
      <MobileOcrConfirm
        initialText={wr.extractedText ?? ''}
        submitting={submitting}
        onSubmit={(t) => startAnalyzeWith(t)}
        onBack={() => router.push('/')}
        errorMessage={wr.errorMessage}
        imageUrl={
          entry.originalKind === 'image' ? entry.originalUrl : undefined
        }
      />
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>추출된 내용을 확인하고 수정해 주세요</h1>
        <p className={styles.subtitle}>
          취업규칙에서 <strong>잘못 읽힌 숫자·날짜·조항 번호</strong> 등을{' '}
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
            aria-label="추출된 취업규칙 텍스트"
          />
        </section>

        {wr.errorMessage && (
          <div className={styles.error}>
            <strong>분석 실패:</strong> {wr.errorMessage}
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
