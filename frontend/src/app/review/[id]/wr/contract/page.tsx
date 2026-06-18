'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import SiteHeader from '@/components/layout/SiteHeader';
import WrDocumentView, {
  countWrChanges,
  stripWrMarkers,
} from '@/components/review/WrDocumentView';
import { getCase, updateWr } from '@/lib/reviewStore';
import { downloadWrDocx } from '@/lib/api/review';
import { ApiCallError } from '@/lib/api/client';

import styles from './page.module.css';

/**
 * 취업규칙 — 수정본 페이지.
 *
 * 철학: 문제없는 조항은 원문 그대로 두고, 사용자가 담은 수정 항목만 반영.
 *
 * generatedText 는 백엔드(revise mark_changes=True)가 교체·추가 문구를
 * 【수정】…【/수정】 마커로 감싼 본문 — 이 페이지가 canonical 로 보관한다.
 *
 *   - [문서 보기] (기본): A4 종이 카드 — 마커 구간 형광펜 + '수정됨' 칩,
 *     단락 클릭 시 인라인 편집. 마커 없는 구 캐시 본문도 일반 문서로 렌더.
 *   - [텍스트 보기]: 마커 제거한 전문 textarea (기존 기능 유지) — 단,
 *     여기서 편집하면 마커가 사라져 형광펜 표시가 해제된다.
 *   - 복사 / 인쇄·PDF / 다운로드(.txt, .docx): 마커 제거 + 현재 편집 반영 본문.
 */
export default function WrContractPage({ params }: { params: { id: string } }) {
  const caseId = params.id;

  // 주의: 모든 훅은 조기 return 보다 위 — 조건부 return 뒤에 두면
  // 렌더 간 훅 개수가 달라져 client-side exception 발생.
  const [mounted, setMounted] = useState(false);
  const [entry, setEntry] = useState<ReturnType<typeof getCase>>(null);
  /** 마커 포함 canonical 본문 — 문서 뷰 편집·텍스트 뷰 편집 모두 여기로 수렴. */
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<'doc' | 'text'>('doc');
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const originalRef = useRef('');

  useEffect(() => {
    setMounted(true);
    const e = getCase(caseId);
    setEntry(e);
    const generated = e?.wr?.generatedText ?? '';
    originalRef.current = generated;
    setDraft(generated);
  }, [caseId]);

  const filename = useMemo(() => {
    const base = entry?.originalFilename || '취업규칙';
    const stripped = base.replace(/\.(png|jpe?g|pdf|docx?|hwpx?|txt)$/i, '');
    return `${stripped}_수정본.txt`;
  }, [entry]);

  /** 마커 제거 + 현재 편집 반영 — 복사·다운로드·텍스트 뷰 표시용. */
  const plainDraft = useMemo(() => stripWrMarkers(draft), [draft]);

  /** 형광펜 구간 수 — 0 이면(구 캐시 등) 배너 없이 일반 문서로 렌더. */
  const changeCount = useMemo(() => countWrChanges(draft), [draft]);

  if (!mounted) {
    return <main className={styles.page} aria-hidden />;
  }
  if (!entry?.wr?.generatedText) {
    return (
      <main className={styles.page}>
        <SiteHeader />
        <div className={styles.containerSimple}>
          <div className={styles.notFound}>
            <h1>수정본이 없습니다</h1>
            <p>
              <Link href={`/review/${caseId}`}>← 검토 결과로 돌아가기</Link>
            </p>
          </div>
        </div>
      </main>
    );
  }

  /** 문서 뷰(줄 편집)·텍스트 뷰(전문 편집) 공통 — draft 갱신 + dirty 추적. */
  const applyDraft = (next: string) => {
    setDraft(next);
    setDirty(next !== originalRef.current);
  };

  const handleRestore = () => {
    setDraft(originalRef.current);
    setDirty(false);
  };

  const handleSaveEdit = () => {
    // store 에 사용자 편집본(마커 포함) 반영 — 새로고침해도 살아남음
    updateWr(caseId, { generatedText: draft });
    originalRef.current = draft;
    setDirty(false);
  };

  const handleDownload = () => {
    const blob = new Blob([plainDraft], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadDocx = async () => {
    setDownloadingDocx(true);
    setDownloadError(null);
    try {
      const docxName = filename.replace(/\.txt$/i, '.docx');
      await downloadWrDocx({ contract_text: plainDraft, filename: docxName });
    } catch (err) {
      const msg =
        err instanceof ApiCallError
          ? err.detail
          : err instanceof Error
            ? err.message
            : String(err);
      setDownloadError(msg);
    } finally {
      setDownloadingDocx(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plainDraft);
    } catch {
      /* noop */
    }
  };

  return (
    <main className={styles.page}>
      <SiteHeader />
      <div className={styles.layout}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <span className={styles.eyebrow}>취업규칙 · 수정본</span>
            <h1 className={styles.title}>
              취업규칙 수정본
              {dirty && <span className={styles.dirtyBadge}>✎ 편집됨</span>}
            </h1>
            <p className={styles.subtitle}>
              문제없는 조항은 원문 그대로 두고, 담은 수정 항목만 반영했습니다.
              단락을 클릭하면 본문을 직접 고칠 수 있어요.
            </p>
          </div>
          <div className={`${styles.topbarRight} noPrint`}>
            <Link href={`/review/${caseId}`} className={styles.btnSecondary}>
              ← 결과로
            </Link>
          </div>
        </header>

        {/* 보기 전환 + 편집 저장/되돌리기 */}
        <div className={`${styles.toolbar} noPrint`}>
          <div
            className={styles.viewToggle}
            role="tablist"
            aria-label="수정본 보기 방식"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === 'doc'}
              className={`${styles.viewBtn} ${view === 'doc' ? styles.viewBtnActive : ''}`}
              onClick={() => setView('doc')}
            >
              📄 문서 보기
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'text'}
              className={`${styles.viewBtn} ${view === 'text' ? styles.viewBtnActive : ''}`}
              onClick={() => setView('text')}
            >
              ≡ 텍스트 보기
            </button>
          </div>
          {dirty && (
            <div className={styles.toolbarActions}>
              <button
                type="button"
                className={styles.btnTertiary}
                onClick={handleRestore}
                title="생성된 수정본으로 되돌리기"
              >
                ↺ 되돌리기
              </button>
              <button
                type="button"
                className={styles.btnTertiary}
                onClick={handleSaveEdit}
                title="현재 편집본을 저장 (새로고침해도 유지)"
              >
                💾 편집 저장
              </button>
            </div>
          )}
        </div>

        {/* 요약 배너 — 형광펜 표시 안내 */}
        {view === 'doc' && changeCount > 0 && (
          <div className={`${styles.banner} noPrint`} role="status">
            <span className={styles.bannerMain}>
              ✓ {changeCount}곳이 수정·보완되었어요 — 형광펜 표시된 부분이에요
            </span>
            <span className={styles.bannerSub}>
              단락을 클릭하면 직접 편집할 수 있어요
            </span>
          </div>
        )}

        {/* ── 문서 보기 — A4 종이 카드 (텍스트 보기 중엔 숨김·상태 유지) ── */}
        <div
          className={view === 'doc' ? styles.docWrap : styles.hiddenView}
          aria-hidden={view !== 'doc'}
        >
          <WrDocumentView text={draft} onTextChange={applyDraft} />
        </div>

        {/* ── 텍스트 보기 — 원본 참고 + 마커 제거 전문 textarea ── */}
        {view === 'text' && (
          <div className={`${styles.split} printStack`}>
            {/* 좌 — 원본 (참고) */}
            <section className={styles.panel} aria-label="원본 취업규칙">
              <header className={styles.panelHeader}>
                <span className={styles.panelIcon}>📋</span>
                <div>
                  <div className={styles.panelTitle}>원본 취업규칙</div>
                  <div className={styles.panelHint}>참고용 — 편집 불가</div>
                </div>
              </header>
              <pre className={`${styles.body} ${styles.bodyReadonly}`}>
                {entry.wr.extractedText || '(추출 텍스트 없음)'}
              </pre>
            </section>

            {/* 우 — 수정본 전문 (편집 가능) */}
            <section className={styles.panel} aria-label="수정본 취업규칙">
              <header className={styles.panelHeader}>
                <span className={styles.panelIcon}>✨</span>
                <div>
                  <div className={styles.panelTitle}>수정본 전문</div>
                  <div className={styles.panelHint}>
                    직접 편집 가능 — 여기서 수정하면 형광펜 표시는 해제돼요
                  </div>
                </div>
              </header>
              <textarea
                className={styles.editor}
                value={plainDraft}
                onChange={(e) => applyDraft(e.target.value)}
                spellCheck={false}
                placeholder="수정본 본문…"
              />
            </section>
          </div>
        )}

        {/* 액션 바 */}
        <div className={`${styles.actionBar} noPrint`}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={handleCopy}
          >
            📋 클립보드 복사
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => window.print()}
            title="브라우저 인쇄 — PDF 저장 가능 (형광펜 표시 유지)"
          >
            📄 인쇄·PDF
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={handleDownload}
          >
            ⬇ 텍스트 (.txt)
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={handleDownloadDocx}
            disabled={downloadingDocx}
            title="MS Word 호환 .docx — 사내 워드프로세서에서 그대로 편집·인쇄"
          >
            {downloadingDocx ? '변환 중…' : '⬇ Word 문서 (.docx)'}
          </button>
        </div>

        {downloadError && (
          <div className={`${styles.errorBox} noPrint`}>
            <strong>DOCX 다운로드 실패:</strong> {downloadError}
          </div>
        )}

        <footer className={styles.footer}>
          <span className={styles.footerNote}>
            ⚠️ 이 본문은 AI 가 수정 항목만 반영해 생성한 수정본입니다. 취업규칙
            변경은 근로자 과반수 의견 청취·동의 등 법정 절차를 거쳐 확정하세요.
          </span>
        </footer>
      </div>
    </main>
  );
}
