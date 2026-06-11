'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import ContractFormView, {
  buildContractText,
  buildEcFormModel,
  type ContractFormState,
} from '@/components/review/ContractFormView';
import { getCase } from '@/lib/reviewStore';
import { downloadEcDocx } from '@/lib/api/ec';
import { ApiCallError } from '@/lib/api/client';

import styles from './page.module.css';

/**
 * Step4 — 표준 근로계약서 페이지.
 *
 * 두 가지 보기:
 * - **양식 보기 (기본)** — 고용노동부 표준 서식 모양 그대로 렌더, 사용자의
 *   계약 내용(structuredData)을 결정적으로 칸에 채움. 부적절/보완필요 칸은
 *   표준 문구(또는 사용자 담은 표현)로 보완 + '보완됨' 표시. 모든 칸 편집 가능.
 * - **텍스트 보기** — 기존 LLM 생성 본문 textarea (그대로 유지).
 *
 * 다운로드·복사·인쇄는 항상 현재 보기의 최신 편집본을 사용한다.
 * 훅 순서 주의 — 모든 훅은 조기 return 위에서 호출 (이전 hook-order 버그 재발 금지).
 */
export default function EcContractPage({
  params,
}: {
  params: { id: string };
}) {
  const caseId = params.id;

  // ─── HOOK ORDER — 모든 훅은 조기 return 보다 위 ───
  const [mounted, setMounted] = useState(false);
  const [entry, setEntry] = useState<ReturnType<typeof getCase>>(null);
  const [draft, setDraft] = useState<string>('');
  const originalRef = useRef<string>('');
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  /** 보기 모드 — 양식(기본) / 텍스트. structuredData 없으면 텍스트로 강제. */
  const [view, setView] = useState<'form' | 'text'>('form');
  /** 양식 편집 상태 — null 이면 자동 채움(초기값) 그대로. */
  const [formState, setFormState] = useState<ContractFormState | null>(null);

  useEffect(() => {
    setMounted(true);
    const e = getCase(caseId);
    setEntry(e);
    const text = e?.ec?.generatedContract ?? '';
    setDraft(text);
    originalRef.current = text;
  }, [caseId]);

  /**
   * 양식 모델 — structuredData/analysis/userOverrides 만으로 결정적 채움.
   * generatedContract(LLM 자유 텍스트)는 절대 파싱하지 않는다.
   */
  const formModel = useMemo(() => {
    const ec = entry?.ec;
    if (!ec?.structuredData) return null;
    try {
      return buildEcFormModel(
        ec.structuredData,
        ec.analysisResult ?? null,
        ec.userOverrides ?? {},
      );
    } catch {
      return null;
    }
  }, [entry]);

  const activeView: 'form' | 'text' =
    formModel && view === 'form' ? 'form' : 'text';
  const effectiveForm = formState ?? formModel?.state ?? null;

  /** 다운로드·복사에 쓰일 현재 보기의 텍스트. */
  const activeText =
    activeView === 'form' && effectiveForm
      ? buildContractText(effectiveForm)
      : draft;

  const filenameBase =
    (entry?.originalFilename || '근로계약서')
      .replace(/\.[^.]+$/, '')
      .trim() || '근로계약서';

  const dirty = draft.trim() !== originalRef.current.trim();
  const formDirty = formState !== null;

  const pushToast = (msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  const handleDownload = useCallback(() => {
    if (!activeText) return;
    const blob = new Blob([activeText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameBase}_표준양식.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    pushToast('✓ 텍스트 파일로 저장됨');
  }, [activeText, filenameBase]);

  const handleDownloadDocx = useCallback(async () => {
    if (!activeText) return;
    setDownloadingDocx(true);
    try {
      await downloadEcDocx({
        contract_text: activeText,
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
  }, [activeText, filenameBase]);

  const handlePrint = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.print();
  }, []);

  const handleCopy = useCallback(async () => {
    if (!activeText) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(activeText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = activeText;
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
  }, [activeText]);

  const handleReset = () => {
    if (activeView === 'form') {
      setFormState(null);
      pushToast('자동 입력값으로 되돌렸어요');
    } else {
      setDraft(originalRef.current);
      pushToast('LLM 원본으로 되돌렸어요');
    }
  };

  // ─── 조기 return — 훅은 모두 위에서 끝남 ───

  if (!mounted) {
    return <main className={styles.page} aria-hidden />;
  }

  if (!originalRef.current && !formModel) {
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
        <div className={styles.head}>
          {activeView === 'text' && dirty && (
            <span className={styles.dirtyBadge}>✎ 편집됨</span>
          )}
          {activeView === 'form' && formDirty && (
            <span className={styles.dirtyBadge}>✎ 편집됨</span>
          )}
        </div>
        <h1 className={styles.title}>표준 근로계약서</h1>
        <div className={styles.subtitle}>
          {activeView === 'form' ? (
            <>
              <strong>고용노동부 표준 서식</strong>에 검토하신 계약 내용을{' '}
              <strong>그대로 채워 넣은 양식</strong>이에요.{' '}
              <span className={styles.legendFix}>보완됨</span> 칸은
              부적절·보완필요 판정을 표준 문구(또는 직접 담은 표현)로 채운
              것이고, <span className={styles.legendWarn}>확인필요</span> 칸은
              직접 확인 후 입력이 필요해요. 모든 칸은 클릭해서 수정할 수
              있습니다.
            </>
          ) : (
            <>
              <strong>분석 결과의 보완사항</strong>을 반영해 LLM 이 생성한{' '}
              <strong>초안</strong>이에요. 본문을 클릭해{' '}
              <strong>사업장 정보·금액·날짜를 직접 채워 넣을 수 있고</strong>,
              수정한 내용 그대로 다운로드·복사·인쇄됩니다.
            </>
          )}
        </div>

        {formModel && (
          <div
            className={styles.toggleBar}
            role="tablist"
            aria-label="계약서 보기 방식"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'form'}
              className={`${styles.toggleBtn} ${
                activeView === 'form' ? styles.toggleActive : ''
              }`}
              onClick={() => setView('form')}
            >
              양식 보기
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'text'}
              className={`${styles.toggleBtn} ${
                activeView === 'text' ? styles.toggleActive : ''
              }`}
              onClick={() => setView('text')}
            >
              텍스트 보기
            </button>
          </div>
        )}

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
            onClick={handlePrint}
          >
            🖨 인쇄 / PDF
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
            onClick={handleCopy}
          >
            {copied ? '✓ 복사됨' : '📋 클립보드 복사'}
          </button>
          {((activeView === 'form' && formDirty) ||
            (activeView === 'text' && dirty)) && (
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={handleReset}
            >
              {activeView === 'form'
                ? '↺ 자동입력으로 되돌리기'
                : '↺ 원본으로 되돌리기'}
            </button>
          )}
          <Link href={`/review/${caseId}/ec`} className={styles.btnSecondary}>
            ← 검토 결과
          </Link>
        </div>

        {activeView === 'form' && effectiveForm && formModel ? (
          <ContractFormView
            value={effectiveForm}
            flags={formModel.flags}
            onChange={setFormState}
          />
        ) : (
          <textarea
            className={styles.contractEditor}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            placeholder="생성된 계약서 본문이 없어요. [양식 보기]를 사용해 주세요."
            aria-label="표준 근로계약서 본문 (편집 가능)"
          />
        )}

        <div className={styles.copyHint}>
          ※ 표준 양식은 참고용입니다. 사업장 실정에 맞게 사업주·근로자가 협의하여 확정·서명해 주세요.
          {activeView === 'text' && dirty && (
            <>
              {' '}
              <strong>현재 편집본이 다운로드·복사에 그대로 사용됩니다.</strong>
            </>
          )}
          {activeView === 'form' && (
            <>
              {' '}
              <strong>양식에 입력한 내용 그대로 다운로드·복사·인쇄됩니다.</strong>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
