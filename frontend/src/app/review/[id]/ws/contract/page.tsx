'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import SiteHeader from '@/components/layout/SiteHeader';
import { getCase, updateWs } from '@/lib/reviewStore';
import { downloadWsDocx } from '@/lib/api/ws';
import { ApiCallError } from '@/lib/api/client';

import styles from './page.module.css';

/**
 * 임금명세서 — 수정 반영된 표준 본문 (Step 4 베타).
 *
 * 좌측: 원본 임금명세서 (참고)
 * 우측: 시정안 반영된 표준 본문 (textarea — 사용자 편집 가능)
 *
 * 기능:
 *   - 복사 / 다운로드 (.txt)
 *   - 편집 시 dirty 표시 + 원본으로 되돌리기
 */
export default function WsContractPage({ params }: { params: { id: string } }) {
  const caseId = params.id;

  const [mounted, setMounted] = useState(false);
  const [entry, setEntry] = useState<ReturnType<typeof getCase>>(null);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const originalRef = useRef('');

  useEffect(() => {
    setMounted(true);
    const e = getCase(caseId);
    setEntry(e);
    const generated = e?.ws?.generatedWageText ?? '';
    originalRef.current = generated;
    setDraft(generated);
  }, [caseId]);

  const filename = useMemo(() => {
    const base = entry?.originalFilename || '임금명세서';
    const stripped = base.replace(/\.(png|jpe?g|pdf|docx?|hwp|txt)$/i, '');
    return `${stripped}_수정본.txt`;
  }, [entry]);

  if (!mounted) {
    return <main className={styles.page} aria-hidden />;
  }
  if (!entry?.ws?.generatedWageText) {
    return (
      <main className={styles.page}>
        <SiteHeader />
        <div className={styles.containerSimple}>
          <div className={styles.notFound}>
            <h1>수정된 명세서가 없습니다</h1>
            <p>
              <Link href={`/review/${caseId}/ws`}>← 검토 결과로 돌아가기</Link>
            </p>
          </div>
        </div>
      </main>
    );
  }

  const handleEdit = (v: string) => {
    setDraft(v);
    setDirty(v !== originalRef.current);
  };

  const handleRestore = () => {
    setDraft(originalRef.current);
    setDirty(false);
  };

  const handleSaveEdit = () => {
    // store 에 사용자 편집본 반영 — 새로고침해도 살아남음
    updateWs(caseId, { generatedWageText: draft });
    originalRef.current = draft;
    setDirty(false);
  };

  const handleDownload = () => {
    const blob = new Blob([draft], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownloadDocx = async () => {
    setDownloadingDocx(true);
    setDownloadError(null);
    try {
      const docxName = filename.replace(/\.txt$/i, '.docx');
      await downloadWsDocx({ wage_text: draft, filename: docxName });
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
      await navigator.clipboard.writeText(draft);
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
            <span className={styles.eyebrow}>임금명세서 · Step 4</span>
            <h1 className={styles.title}>
              시정안 반영된 표준 임금명세서
              {dirty && <span className={styles.dirtyBadge}>✎ 편집됨</span>}
            </h1>
            <p className={styles.subtitle}>
              분석에서 지적된 누락·부적절 항목을 모두 반영했습니다. 필요하면
              아래 편집창에서 직접 수정 후 다운로드하세요.
            </p>
          </div>
          <div className={`${styles.topbarRight} noPrint`}>
            <Link
              href={`/review/${caseId}/ws`}
              className={styles.btnSecondary}
            >
              ← 검토 결과로
            </Link>
          </div>
        </header>

        <div className={`${styles.split} printStack`}>
          {/* 좌 — 원본 (참고) */}
          <section className={styles.panel} aria-label="원본 임금명세서">
            <header className={styles.panelHeader}>
              <span className={styles.panelIcon}>📋</span>
              <div>
                <div className={styles.panelTitle}>원본 명세서</div>
                <div className={styles.panelHint}>참고용 — 편집 불가</div>
              </div>
            </header>
            <pre className={`${styles.body} ${styles.bodyReadonly}`}>
              {entry.ws.extractedText || '(추출 텍스트 없음)'}
            </pre>
          </section>

          {/* 우 — 수정안 (편집 가능) */}
          <section className={styles.panel} aria-label="시정안 반영 명세서">
            <header className={styles.panelHeader}>
              <span className={styles.panelIcon}>✨</span>
              <div>
                <div className={styles.panelTitle}>시정 반영 표준안</div>
                <div className={styles.panelHint}>
                  텍스트 영역에서 직접 편집 가능 — 다운로드 전 검토하세요
                </div>
              </div>
              <div className={styles.panelActions}>
                {dirty && (
                  <>
                    <button
                      type="button"
                      className={styles.btnTertiary}
                      onClick={handleRestore}
                      title="LLM 생성 원본으로 되돌리기"
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
                  </>
                )}
              </div>
            </header>
            <textarea
              className={styles.editor}
              value={draft}
              onChange={(e) => handleEdit(e.target.value)}
              spellCheck={false}
              placeholder="시정안 본문…"
            />
          </section>
        </div>

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
            title="브라우저 인쇄 — PDF 저장 가능"
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
          <div
            style={{
              marginTop: 8,
              padding: '10px 14px',
              background: '#fee2e2',
              border: '1px solid #fca5a5',
              borderRadius: 8,
              color: '#991b1b',
              fontSize: 13,
            }}
            className="noPrint"
          >
            <strong>DOCX 다운로드 실패:</strong> {downloadError}
          </div>
        )}

        <footer className={styles.footer}>
          <span className={styles.footerNote}>
            ⚠️ 이 본문은 LLM 이 생성한 표준안입니다. 실제 임금 금액·세금 공제율 등
            정확한 수치는 사업장 자체 검토가 필요합니다.
          </span>
        </footer>
      </div>
    </main>
  );
}
