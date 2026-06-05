'use client';

import { Fragment, useMemo, useState, type ReactNode } from 'react';

import type { EcAnalysisItem, EcAnalysisResult } from '@/lib/api/types';
import { buildMarkerHits } from './ecMarkers';

import styles from './MobileEcResult.module.css';

/* ════════════════════════════════════════════════════════
 * MobileEcResult — 근로계약서 검토 결과 모바일 전용 화면.
 *   데모(최초안 인터랙션.html)의 V/order 배열·렌더 로직을 React state 로 포팅.
 *   p1(판정+위반목록) ↔ p2(계약서 원문) + 하단 시트(상세).
 *   번호는 어디서나 `violations 인덱스 + 1` 로 일치.
 * ════════════════════════════════════════════════════════ */

interface MobileEcResultProps {
  analysis: EcAnalysisResult;
  /** 적절성!=='적절' 만, 부적절→보완필요 순으로 이미 정렬된 공유 목록. 번호 = index+1. */
  violations: EcAnalysisItem[];
  /** 적절 건수 — 통계에만. */
  okCount: number;
  stats: { 부적절: number; 보완필요: number; 적절: number };
  caseId: string;
  filename: string;
  imageUrl?: string;
  extractedText: string;
  /** p1 에서 뒤로 — 없으면 아무 동작 안 함(p2→p1·시트닫기는 자체 처리). */
  onBackToHome?: () => void;
}

type Tone = 'bad' | 'warn';

function toneOf(s: EcAnalysisItem['적절성']): Tone {
  return s === '부적절' ? 'bad' : 'warn';
}

function kdLabel(s: EcAnalysisItem['적절성']): string {
  return s === '부적절' ? '부적절' : '보완필요';
}

/** 목록·시트 헤더용 한 줄 사유. 발견내용 앞부분 + 적절성. */
function oneLineReason(item: EcAnalysisItem): string {
  const found = (item.발견내용 || '').trim();
  const isMissing =
    !found ||
    /^(미기재|없음|누락|미작성|판독불가|해당없음|미상|—|-)$/.test(found);
  if (isMissing) {
    return item.적절성 === '부적절' ? '미기재 · 부적절' : '미기재 · 보완필요';
  }
  const head = found.length > 40 ? `${found.slice(0, 40)}…` : found;
  return `${head} · ${item.적절성}`;
}

/** 판정 대표 단어 + 색 톤. overallStatus 우선, 없으면 riskLevel 로 추정. */
function verdictView(analysis: EcAnalysisResult): { word: string; tone: Tone | 'ok' } {
  const status = (analysis.overallStatus || '').trim();
  if (status === '위험' || status === '부적합' || status === '부적절') {
    return { word: status || '위험', tone: 'bad' };
  }
  if (status === '적정' || status === '양호' || status === '적합') {
    return { word: status, tone: 'ok' };
  }
  if (status === '보완필요' || status === '주의') {
    return { word: status, tone: 'warn' };
  }
  // status 가 비었거나 알 수 없으면 riskLevel 로 추정
  const risk = (analysis.riskLevel || '').trim();
  if (risk === '상') return { word: '위험', tone: 'bad' };
  if (risk === '하') return { word: '양호', tone: 'ok' };
  return { word: status || '보완필요', tone: 'warn' };
}

export default function MobileEcResult({
  analysis,
  violations,
  okCount,
  stats,
  filename,
  extractedText,
  onBackToHome,
}: MobileEcResultProps) {
  const [page, setPage] = useState<'p1' | 'p2'>('p1');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [curIndex, setCurIndex] = useState(0);
  const [filter, setFilter] = useState<'all' | 'bad' | 'warn'>('all');
  const [docClean, setDocClean] = useState(false);
  const [copied, setCopied] = useState(false);

  const total = violations.length;
  const badN = stats.부적절;
  const warnN = stats.보완필요;

  const verdict = useMemo(() => verdictView(analysis), [analysis]);
  const verdictCardCls =
    verdict.tone === 'bad'
      ? styles.verdictBad
      : verdict.tone === 'ok'
        ? styles.verdictOk
        : styles.verdictWarn;
  const badgeChar = verdict.tone === 'ok' ? '✓' : '!';

  // 판정 요약 1줄 — overallOpinion (없으면 합산 문구). 2~3줄 클램프(CSS).
  const summary =
    (analysis.overallOpinion || '').trim() ||
    `검토 ${total + stats.적절}개 항목 중 ${total}건 보완·수정이 필요합니다.`;

  const filtered = useMemo(
    () =>
      violations
        .map((v, i) => ({ v, i }))
        .filter(({ v }) => {
          if (filter === 'all') return true;
          if (filter === 'bad') return v.적절성 === '부적절';
          return v.적절성 === '보완필요';
        }),
    [violations, filter],
  );

  // 계약서 본문 — buildMarkerHits 로 위반 위치를 찾아 vnum + mark 로 강조.
  const docBody: ReactNode = useMemo(() => {
    const text = extractedText || '';
    const hits = buildMarkerHits(text, violations);
    if (!text.trim()) {
      return (
        <span className={styles.vlistEmpty}>추출된 계약서 원문이 없습니다.</span>
      );
    }
    if (hits.length === 0) return <span>{text}</span>;
    const out: ReactNode[] = [];
    let cur = 0;
    hits.forEach((h, idx) => {
      if (h.index > cur) {
        out.push(
          <Fragment key={`t-${cur}`}>{text.slice(cur, h.index)}</Fragment>,
        );
      }
      const tone = toneOf(h.finding.적절성);
      const vnumCls = tone === 'bad' ? styles.vnumBad : styles.vnumWarn;
      const markBase = tone === 'bad' ? styles.vioMarkBad : styles.vioMarkWarn;
      const focusCls =
        h.no - 1 === curIndex
          ? tone === 'bad'
            ? styles.vioMarkFocusBad
            : styles.vioMarkFocusWarn
          : '';
      out.push(
        <span
          key={`vn-${idx}`}
          className={`${styles.vnum} ${vnumCls}`}
          data-vno={h.no}
          role="button"
          tabIndex={0}
          onClick={() => openSheet(h.no - 1)}
        >
          {h.no}
        </span>,
      );
      out.push(
        <mark
          key={`mk-${idx}`}
          className={`vio ${styles.vioMark} ${markBase} ${focusCls}`}
          data-vno={h.no}
          onClick={() => openSheet(h.no - 1)}
        >
          {text.slice(h.index, h.index + h.length)}
        </mark>,
      );
      cur = h.index + h.length;
    });
    if (cur < text.length) {
      out.push(<Fragment key={`t-${cur}`}>{text.slice(cur)}</Fragment>);
    }
    return out;
    // openSheet 는 stable(아래 정의) — curIndex 변할 때만 focus 재계산.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractedText, violations, curIndex]);

  function openSheet(index: number) {
    if (index < 0 || index >= violations.length) return;
    setCurIndex(index);
    setSheetOpen(true);
    setCopied(false);
  }
  function closeSheet() {
    setSheetOpen(false);
  }
  function handleBack() {
    if (sheetOpen) {
      closeSheet();
      return;
    }
    if (page === 'p2') {
      setPage('p1');
      return;
    }
    onBackToHome?.();
  }
  function goPrev() {
    if (total === 0) return;
    setCurIndex((i) => (i - 1 + total) % total);
    setCopied(false);
  }
  function goNext() {
    if (total === 0) return;
    setCurIndex((i) => (i + 1) % total);
    setCopied(false);
  }
  async function handleCopy() {
    const cur = violations[curIndex];
    const txt = (cur?.개선권고 || '').trim();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(txt);
      } else {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    } catch {
      /* 시각 응답이라도 표시 */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  const cur = violations[Math.min(curIndex, Math.max(0, total - 1))];
  const curTone: Tone = cur ? toneOf(cur.적절성) : 'bad';

  return (
    <div className={styles.root} role="dialog" aria-label="근로계약서 검토 결과">
      <div className={styles.frame}>
        {/* 내비 */}
        <div className={styles.nav}>
          <button
            type="button"
            className={styles.bk}
            onClick={handleBack}
            aria-label="뒤로"
          >
            ←
          </button>
          <span className={styles.ttl}>
            {page === 'p1' ? '검토 결과' : '계약서 원문'}
          </span>
          <span className={styles.file}>
            {page === 'p1' ? filename : '1 / 2'}
          </span>
        </div>

        {/* ── PAGE 1 ── */}
        {page === 'p1' && (
          <div className={styles.scroll}>
            <div className={`${styles.verdict} ${verdictCardCls}`}>
              <div className={styles.vtop}>
                <div className={styles.vbadge}>{badgeChar}</div>
                <div className={styles.vt}>
                  <div className={styles.l}>
                    종합 판정{analysis.riskLevel ? ` · 위험도 ${analysis.riskLevel}` : ''}
                  </div>
                  <h2>{verdict.word}</h2>
                  <div className={styles.s}>
                    검토 {total + stats.적절}개 항목 중 {total}건 보완·수정 필요
                  </div>
                </div>
              </div>
              <div className={styles.vdesc}>{summary}</div>
              <div className={styles.vstats}>
                <div className={styles.vstat}>
                  <div className={`${styles.vv} ${styles.vvBad}`}>{stats.부적절}</div>
                  <div className={styles.vl}>부적절</div>
                </div>
                <div className={styles.vstat}>
                  <div className={`${styles.vv} ${styles.vvWarn}`}>{stats.보완필요}</div>
                  <div className={styles.vl}>보완필요</div>
                </div>
                <div className={styles.vstat}>
                  <div className={`${styles.vv} ${styles.vvOk}`}>{okCount}</div>
                  <div className={styles.vl}>적절</div>
                </div>
              </div>
            </div>

            <div className={styles.seccap}>
              먼저 고쳐야 할 항목 <span className={styles.c}>· 심각한 순</span>
            </div>

            <div className={styles.filt}>
              <button
                type="button"
                className={filter === 'all' ? styles.on : ''}
                onClick={() => setFilter('all')}
              >
                전체 {total}
              </button>
              <button
                type="button"
                className={filter === 'bad' ? styles.on : ''}
                onClick={() => setFilter('bad')}
              >
                부적절 {badN}
              </button>
              <button
                type="button"
                className={filter === 'warn' ? styles.on : ''}
                onClick={() => setFilter('warn')}
              >
                보완 {warnN}
              </button>
            </div>

            <div className={styles.vlist}>
              {filtered.length === 0 ? (
                <div className={styles.vlistEmpty}>해당 항목이 없습니다.</div>
              ) : (
                filtered.map(({ v, i }) => {
                  const tone = toneOf(v.적절성);
                  const itemCls =
                    tone === 'bad' ? styles.vitemBad : styles.vitemWarn;
                  return (
                    <button
                      type="button"
                      key={`${v.항목}-${i}`}
                      className={`${styles.vitem} ${itemCls}`}
                      onClick={() => openSheet(i)}
                    >
                      <span className={styles.vn}>{i + 1}</span>
                      <span className={styles.vitemTx}>
                        <span className={styles.vitemNm}>{v.항목}</span>
                        <span className={styles.vitemKd}>{oneLineReason(v)}</span>
                      </span>
                      <span className={styles.chev}>›</span>
                    </button>
                  );
                })
              )}
            </div>

            <button
              type="button"
              className={styles.minibar}
              onClick={() => setPage('p2')}
            >
              <span className={`${styles.vn} ${styles.minibarVnBad}`}>1</span>
              <span className={styles.minibarT}>계약서 원문에서 위치 보기</span>
              <span className={styles.minibarNav}>원문 ›</span>
            </button>
          </div>
        )}

        {/* ── PAGE 2 ── */}
        {page === 'p2' && (
          <>
            <div className={styles.docmodebar}>
              <button
                type="button"
                className={!docClean ? styles.on : ''}
                onClick={() => setDocClean(false)}
              >
                위반 표시
              </button>
              <button
                type="button"
                className={docClean ? styles.on : ''}
                onClick={() => setDocClean(true)}
              >
                원문만
              </button>
            </div>
            <div className={styles.scroll}>
              <div className={`${styles.doc} ${docClean ? styles.docClean : ''}`}>
                {docBody}
              </div>
            </div>
            {cur && (
              <button
                type="button"
                className={styles.minibar}
                onClick={() => openSheet(curIndex)}
              >
                <span
                  className={`${styles.vn} ${
                    curTone === 'bad' ? styles.minibarVnBad : styles.minibarVnWarn
                  }`}
                >
                  {curIndex + 1}
                </span>
                <span className={styles.minibarT}>
                  {cur.항목} {kdLabel(cur.적절성)}
                </span>
                <span className={styles.minibarNav}>탭하여 상세 ›</span>
              </button>
            )}
          </>
        )}

        {/* ── 시트 ── */}
        <button
          type="button"
          className={`${styles.scrim} ${sheetOpen ? styles.on : ''}`}
          aria-label="닫기"
          onClick={closeSheet}
          tabIndex={sheetOpen ? 0 : -1}
        />
        <div
          className={`${styles.sheet} ${sheetOpen ? styles.on : ''}`}
          role="dialog"
          aria-label="항목 상세"
          aria-hidden={!sheetOpen}
        >
          <div className={styles.grab} />
          {cur && (
            <>
              <div className={styles.shead}>
                <span
                  className={`${styles.vn} ${
                    curTone === 'bad' ? styles.sheadVnBad : styles.sheadVnWarn
                  }`}
                >
                  {curIndex + 1}
                </span>
                <span className={styles.shnm}>{cur.항목}</span>
                <span
                  className={`${styles.shkd} ${
                    curTone === 'bad' ? styles.shkdBad : styles.shkdWarn
                  }`}
                >
                  {kdLabel(cur.적절성)}
                </span>
                <span className={styles.shpg}>
                  {String(curIndex + 1).padStart(2, '0')} /{' '}
                  {String(total).padStart(2, '0')}
                </span>
              </div>
              <div className={styles.sbody}>
                <div className={styles.dx}>
                  {cur.항목} 항목이 <b>{kdLabel(cur.적절성)}</b> 상태입니다. 아래
                  제안을 참고해 보완하세요.
                </div>
                <div className={styles.cmp}>
                  <div className={`${styles.cmpBox} ${styles.cmpNow}`}>
                    <div className={styles.cmpLab}>
                      <span className={`${styles.cdot} ${styles.cdotBad}`} />
                      현재 표현
                    </div>
                    <div className={styles.cmpVal}>
                      {(cur.발견내용 || '').trim() || '(기재 없음)'}
                    </div>
                  </div>
                  <div className={`${styles.cmpBox} ${styles.cmpFix}`}>
                    <div className={styles.cmpLab}>
                      <span className={`${styles.cdot} ${styles.cdotFix}`} />
                      제안 표현
                    </div>
                    <div className={styles.cmpVal}>
                      {(cur.개선권고 || '').trim() || '—'}
                    </div>
                  </div>
                </div>
              </div>
              <div className={styles.sfoot}>
                <button
                  type="button"
                  className={styles.arrowbtn}
                  onClick={goPrev}
                  aria-label="이전 항목"
                >
                  ‹
                </button>
                <button type="button" className={styles.ghost} onClick={handleCopy}>
                  {copied ? '복사됨 ✓' : '복사'}
                </button>
                <button type="button" className={styles.prim} onClick={goNext}>
                  다음 항목 ›
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
