'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import { getCase } from '@/lib/reviewStore';
import { StepProgress } from '@/components/review/StepProgress';
import { downloadEcDocx } from '@/lib/api/ec';
import { ApiCallError } from '@/lib/api/client';

import styles from './page.module.css';

/**
 * Step4 — LLM 이 생성한 표준 근로계약서 본문 페이지.
 *
 * 본문은 `<textarea>` 로 사용자가 직접 다듬을 수 있고,
 * 다운로드·인쇄·복사 모두 편집된 최종 텍스트를 사용한다.
 * "원본으로 되돌리기" 로 LLM 초안 재호출 없이 원본 복원 가능.
 */
export default function EcContractPage({
  params,
}: {
  params: { id: string };
}) {
  const caseId = params.id;
  const [mounted, setMounted] = useState(false);
  const [entry, setEntry] = useState<ReturnType<typeof getCase>>(null);
  const [draft, setDraft] = useState<string>('');
  const originalRef = useRef<string>('');
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
    const e = getCase(caseId);
    setEntry(e);
    const text = e?.ec?.generatedContract ?? '';
    setDraft(text);
    originalRef.current = text;
  }, [caseId]);

  const filenameBase =
    (entry?.originalFilename || '근로계약서')
      .replace(/\.[^.]+$/, '')
      .trim() || '근로계약서';

  const dirty = draft.trim() !== originalRef.current.trim();

  const pushToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  const handleDownload = useCallback(() => {
    if (!draft) return;
    const blob = new Blob([draft], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameBase}_표준양식.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    pushToast('✓ 텍스트 파일로 저장됨');
  }, [draft, filenameBase]);

  const [downloadingDocx, setDownloadingDocx] = useState(false);

  const handleDownloadDocx = useCallback(async () => {
    if (!draft) return;
    setDownloadingDocx(true);
    try {
      await downloadEcDocx({
        contract_text: draft,
        filename: `${filenameBase}_표준양식.docx`,
      });
      pushToast('✓ Word 문서로 저장됨');
    } catch (err) {
      const msg =
        err instanceof ApiCallError
          ? err.detail
          : err instanceof Error
            ? err.message
            : String(err);
      pushToast(`DOCX 변환 실패: ${msg}`);
    } finally {
      setDownloadingDocx(false);
    }
  }, [draft, filenameBase]);

  const handlePrint = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.print();
  }, []);

  const handleCopy = useCallback(async () => {
    if (!draft) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(draft);
      } else {
        const ta = document.createElement('textarea');
        ta.value = draft;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* noop */
    }
  }, [draft]);

  const handleReset = () => {
    setDraft(originalRef.current);
    pushToast('LLM 원본으로 되돌렸어요');
  };

  if (!mounted) {
    return <main className={styles.page} aria-hidden />;
  }

  if (!originalRef.current) {
    return (
      <main className={styles.page}>
        <div className={styles.layout}>
          <div className={styles.notFound}>
            <h1 className={styles.title}>생성된 계약서가 없습니다</h1>
            <p>
              <Link href={`/review/${caseId}/ec`}>← 검토 결과로 돌아가기</Link>
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.layout}>
        {toast && (
          <div className={styles.toast} role="status" aria-live="polite">
            {toast}
          </div>
        )}
        <StepProgress current={4} reviewId={caseId} />
        <div className={styles.head}>
          {dirty && <span className={styles.dirtyBadge}>✎ 편집됨</span>}
        </div>
        <h1 className={styles.title}>표준 근로계약서</h1>
        <div className={styles.subtitle}>
          <strong>분석 결과의 보완사항</strong>을 반영해 LLM 이 생성한{' '}
          <strong>초안</strong>이에요. 본문을 클릭해{' '}
          <strong>사업장 정보·금액·날짜를 직접 채워 넣을 수 있고</strong>, 수정한 내용 그대로
          다운로드·복사·인쇄됩니다.
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={handleDownloadDocx}
            disabled={downloadingDocx}
            title="MS Word 호환 .docx — 사내 워드에서 그대로 편집·인쇄"
          >
            {downloadingDocx ? '변환 중…' : '⬇ Word 문서 (.docx)'}
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
            className={styles.btnSecondary}
            onClick={handlePrint}
          >
            🖨 인쇄 / PDF
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={handleCopy}
          >
            {copied ? '✓ 복사됨' : '📋 클립보드 복사'}
          </button>
          {dirty && (
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={handleReset}
            >
              ↺ 원본으로 되돌리기
            </button>
          )}
          <Link href={`/review/${caseId}/ec`} className={styles.btnSecondary}>
            ← 검토 결과
          </Link>
        </div>

        <textarea
          className={styles.contractEditor}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          aria-label="표준 근로계약서 본문 (편집 가능)"
        />

        <div className={styles.copyHint}>
          ※ 표준 양식은 참고용입니다. 사업장 실정에 맞게 사업주·근로자가 협의하여 확정·서명해 주세요.
          {dirty && (
            <>
              {' '}
              <strong>현재 편집본이 다운로드·복사에 그대로 사용됩니다.</strong>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
