'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import Icon from '@/components/ui/Icon';
import { useMockProgress } from '@/hooks/useMockProgress';
import { getCase } from '@/lib/reviewStore';
import type { EcPhase } from '@/lib/reviewStore';
import type { DocumentType } from '@/types/review';
import styles from './LoadingScreen.module.css';

/**
 * 검토 진행 중 화면.
 *
 * 두 가지 단계 군을 동일 컴포넌트가 처리:
 *
 *   (A) 단일 호출 흐름 (취업규칙) — 업로드 후 분석까지 한 번에. `DOC_CONFIG` 사용.
 *   (B) EC 풀 이식 4단계 — phase 별로 다른 `EC_PHASE_CONFIG` 사용.
 *       · 'extracting'/'structuring' → 추출+구조화 진행 → 끝나면 검토 페이지로
 *       · 'analyzing'                → 33매핑 분석 → 끝나면 결과 페이지로
 *       · 'generating'               → 표준 계약서 생성 → 끝나면 계약서 페이지로
 */

interface Step {
  n: number;
  title: string;
  desc: string;
}

interface LoadingConfig {
  title: string;
  steps: Step[];
  /** mockProgress 의 총 시간(ms). 단계 수에 따라 달라짐. */
  durationMs: number;
}

const DOC_CONFIG: Record<DocumentType, LoadingConfig> = {
  'work-rules': {
    title: '취업규칙을 꼼꼼히 살펴보고 있어요',
    steps: [
      { n: 1, title: '문서 추출', desc: 'DOCX·HWP·PDF·TXT 텍스트로 변환' },
      { n: 2, title: '조항 식별', desc: '조 단위로 분류해 검토 준비' },
      { n: 3, title: '법령 비교', desc: '위반 사항 평가' },
      { n: 4, title: '리포트 생성', desc: '위험도·시정 가이드·법령 근거 작성' },
    ],
    durationMs: 90000,
  },
  'employment-contract': {
    title: '근로계약서를 꼼꼼히 살펴보고 있어요',
    steps: [
      { n: 1, title: '문서 추출', desc: '이미지·DOCX·HWP·PDF·TXT 텍스트로 변환' },
      { n: 2, title: '필수 항목 식별', desc: '필수 기재사항 단위로 정리' },
      { n: 3, title: '법령 비교', desc: '근로기준법 제17조 등 위반 여부 확인' },
      { n: 4, title: '리포트 생성', desc: '적절·보완필요·부적절 분류 + 시정안 작성' },
    ],
    durationMs: 90000,
  },
  'wage-statement': {
    title: '임금명세서를 꼼꼼히 살펴보고 있어요',
    steps: [
      { n: 1, title: '문서 추출', desc: '명세서 텍스트·표 데이터 추출' },
      { n: 2, title: '필수 항목 식별', desc: '교부 의무 항목 매칭' },
      { n: 3, title: '법령 비교', desc: '근로기준법 제48조 등 위반 여부 확인' },
      { n: 4, title: '리포트 생성', desc: '적절·보완필요·부적절 분류 + 시정안 작성' },
    ],
    durationMs: 90000,
  },
  'service-provider-contract': {
    title: '노무제공자 계약서를 꼼꼼히 살펴보고 있어요',
    steps: [
      { n: 1, title: '문서 추출', desc: '이미지·DOCX·PDF 텍스트로 변환' },
      { n: 2, title: '슬롯 구조화', desc: '4섹션·16슬롯으로 정리' },
      { n: 3, title: '법령 비교', desc: '산재보험법·고용보험법·근로자성 위장 검토' },
      { n: 4, title: '리포트 생성', desc: '적절·보완필요·부적절 분류 + 시정안 작성' },
    ],
    durationMs: 90000,
  },
};

/**
 * EC 풀 이식 phase 별 로딩 카피.
 * 'extracting'·'structuring' 은 holistic 한 "검토 준비" 로 묶어서 보여줌.
 */
const EC_PHASE_CONFIG: Partial<Record<EcPhase, LoadingConfig>> = {
  analyzing: {
    title: '법령을 비교하고 결과를 정리하고 있어요',
    steps: [
      { n: 1, title: '법령 비교', desc: '근로기준법·관련 법령 위반 여부 확인' },
      { n: 2, title: '리포트 생성', desc: '적절·보완필요·부적절 분류 + 개선 권고 작성' },
    ],
    durationMs: 30000,
  },
  generating: {
    title: '표준 근로계약서 초안을 작성하고 있어요',
    steps: [
      { n: 1, title: '양식 정리', desc: '고용노동부 표준 양식 적용' },
      { n: 2, title: '본문 작성', desc: '분석 결과·보완사항 반영, 최저시급 보정' },
    ],
    durationMs: 15000,
  },
};

interface LoadingScreenProps {
  /** 라우트의 review id — 100% 도달 시 결과 페이지(/review/{id})로 이동에 사용. UI 노출 X. */
  reviewId?: string;
}

function resolvePhase(reviewId: string | undefined): EcPhase | undefined {
  if (typeof window === 'undefined' || !reviewId) return undefined;
  return getCase(reviewId)?.ec?.phase;
}

function resolveDocType(reviewId: string | undefined): DocumentType {
  if (typeof window === 'undefined' || !reviewId) return 'work-rules';
  return getCase(reviewId)?.documentType ?? 'work-rules';
}

export function LoadingScreen({ reviewId }: LoadingScreenProps) {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | null>(null);
  // 첫 렌더부터 정확한 문서 종류·phase 를 잡기 위해 lazy initializer 로 store 동기 조회.
  const [docType, setDocType] = useState<DocumentType>(() => resolveDocType(reviewId));
  const [phase, setPhase] = useState<EcPhase | undefined>(() => resolvePhase(reviewId));

  // 현재 단계가 EC 의 후반(analyze/generate) 인지에 따라 다른 config 선택.
  const config = useMemo<LoadingConfig>(() => {
    if (phase && EC_PHASE_CONFIG[phase]) {
      return EC_PHASE_CONFIG[phase]!;
    }
    return DOC_CONFIG[docType] ?? DOC_CONFIG['work-rules'];
  }, [docType, phase]);

  // mockProgress 는 phase 가 바뀌면 key 변경으로 자동 재시작 — 별도 reset 로직 불필요.
  // (LoadingScreen 자체가 React 컴포넌트라 useState 가 그대로지만,
  //  useEffect 의 deps 가 totalDurationMs 라 그 값이 바뀌면 timer 재시작됨)
  const { progress, activeStep } = useMockProgress({
    totalSteps: config.steps.length,
    totalDurationMs: config.durationMs,
  });

  // store 폴링 — 단계 전환 및 결과 도달 시 페이지 라우팅.
  useEffect(() => {
    if (!reviewId) return;
    const id = window.setInterval(() => {
      const entry = getCase(reviewId);
      if (!entry) return;

      // documentType / phase 둘 다 동기화 (UI 분기 키)
      if (entry.documentType && entry.documentType !== docType) {
        setDocType(entry.documentType);
      }
      const curPhase = entry.ec?.phase;
      if (curPhase !== phase) {
        setPhase(curPhase);
      }

      // EC 풀 이식 — phase 변화에 따라 다음 페이지로 자동 라우팅.
      if (curPhase === 'review') {
        window.clearInterval(id);
        router.replace(`/review/${reviewId}/ec/review`);
        return;
      }
      if (curPhase === 'result') {
        window.clearInterval(id);
        router.replace(`/review/${reviewId}/ec`);
        return;
      }
      if (curPhase === 'contract') {
        window.clearInterval(id);
        router.replace(`/review/${reviewId}/ec/contract`);
        return;
      }

      // 임금명세서 (beta) — ws.phase 분기.
      const wsPhase = entry.ws?.phase;
      if (wsPhase === 'review') {
        window.clearInterval(id);
        router.replace(`/review/${reviewId}/ws/review`);
        return;
      }
      if (wsPhase === 'result') {
        window.clearInterval(id);
        router.replace(`/review/${reviewId}/ws`);
        return;
      }
      if (wsPhase === 'error') {
        window.clearInterval(id);
        setApiError(entry.ws?.errorMessage || '임금명세서 분석 실패');
        return;
      }

      // 노무제공자 계약서 (Phase 17) — sc.phase 분기.
      const scPhase = entry.sc?.phase;
      if (scPhase === 'review') {
        window.clearInterval(id);
        router.replace(`/review/${reviewId}/sc/review`);
        return;
      }
      // 수정본 완료 — 'result' 보다 먼저 체크 (둘 다 거쳐가는 흐름에서 contract 우선).
      if (scPhase === 'contract') {
        window.clearInterval(id);
        router.replace(`/review/${reviewId}/sc/contract`);
        return;
      }
      if (scPhase === 'result') {
        window.clearInterval(id);
        router.replace(`/review/${reviewId}/sc`);
        return;
      }
      if (scPhase === 'error') {
        window.clearInterval(id);
        setApiError(entry.sc?.errorMessage || '노무제공자 계약서 분석 실패');
        return;
      }

      // 취업규칙 — 추출 텍스트 확인 단계. 'analyzing' 은 라우팅하지 않음
      // (분석 완료 시 아래 status='done' 분기가 /review/[id] 로 보냄).
      const wrPhase = entry.wr?.phase;
      if (wrPhase === 'review') {
        window.clearInterval(id);
        router.replace(`/review/${reviewId}/wr/review`);
        return;
      }
      // 취업규칙 수정본 — 완료 시 contract 페이지로, 생성 중에는 status='done'
      // (기존 분석 완료) 분기가 결과 페이지로 되돌리지 않게 여기서 홀드.
      if (wrPhase === 'contract') {
        window.clearInterval(id);
        router.replace(`/review/${reviewId}/wr/contract`);
        return;
      }
      if (wrPhase === 'generating') {
        return; // 생성 진행 중 — 폴링 유지
      }

      // 취업규칙 등 단일 호출 흐름
      if (entry.status === 'done') {
        window.clearInterval(id);
        const target =
          entry.result?.doc === 'employment-contract'
            ? `/review/${reviewId}/ec`
            : `/review/${reviewId}`;
        router.replace(target);
      } else if (entry.status === 'error') {
        window.clearInterval(id);
        setApiError(entry.error || '알 수 없는 오류');
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [reviewId, router, docType, phase]);

  const STEPS = config.steps;

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        {/* 회전 로더 + 문서 아이콘 */}
        <div className={styles.loader}>
          <svg
            width="100"
            height="100"
            viewBox="0 0 100 100"
            className={styles.spin}
            aria-hidden
          >
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="var(--color-brand-soft)"
              strokeWidth="4"
            />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="var(--color-brand)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="60 200"
            />
          </svg>
          <div className={styles.loaderIcon}>
            <Icon name="doc" size={36} />
          </div>
        </div>

        <div className={styles.eyebrow}>검토 진행중</div>
        <h2 className={styles.title}>{config.title}</h2>
        <div className={styles.subtitle}>
          잠시만 기다려 주세요. 페이지를 닫지 마세요.
        </div>

        {/* 진행률 카드 */}
        <section
          className={styles.progressCard}
          role="status"
          aria-live="polite"
          aria-label={`전체 진행률 ${progress} 퍼센트`}
        >
          <div className={styles.progressHead}>
            <span className={styles.progressLabel}>전체 진행률</span>
            <span className={styles.progressValue}>
              {progress}
              <span className={styles.progressUnit}>%</span>
            </span>
          </div>
          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${progress}%` }} />
          </div>
        </section>

        {/* 단계 리스트 */}
        <ol className={styles.steps} aria-label="검토 단계">
          {STEPS.map((s) => {
            const done = s.n < activeStep;
            const active = s.n === activeStep;
            const badgeClass = done
              ? `${styles.badge} ${styles.badgeDone}`
              : active
                ? `${styles.badge} ${styles.badgeActive}`
                : `${styles.badge} ${styles.badgePending}`;

            return (
              <li
                key={s.n}
                className={`${styles.step} ${!done && !active ? styles.stepPending : ''}`}
                aria-current={active ? 'step' : undefined}
              >
                <div className={badgeClass}>
                  {done ? <Icon name="check" size={14} /> : s.n}
                </div>
                <div className={styles.stepBody}>
                  <div className={styles.stepTitle}>{s.title}</div>
                  <div className={styles.stepDesc}>{s.desc}</div>
                </div>
                {active && (
                  <div className={styles.pulse} aria-hidden>
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                    <span className={styles.dot} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {apiError ? (
          <div
            style={{
              marginTop: 18,
              padding: '16px 18px',
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              borderLeft: '4px solid #dc2626',
              borderRadius: 10,
              color: '#7f1d1d',
              fontSize: 13,
              lineHeight: 1.7,
              textAlign: 'left',
              whiteSpace: 'pre-line',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
              ⚠ 검토를 완료하지 못했어요
            </div>
            <div>{apiError}</div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => router.push('/')}
                style={{
                  background: '#dc2626',
                  border: '1px solid #dc2626',
                  color: '#fff',
                  padding: '8px 14px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ↺ 다시 시도
              </button>
              <button
                type="button"
                onClick={() => router.push('/history')}
                style={{
                  background: 'transparent',
                  border: '1px solid #fca5a5',
                  color: '#7f1d1d',
                  padding: '8px 14px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                📋 내 검토 보기
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.tip}>
            💡 결과 페이지는 PDF로 저장해 사업장에 보관할 수 있어요.
          </div>
        )}
      </div>
    </main>
  );
}

export default LoadingScreen;
