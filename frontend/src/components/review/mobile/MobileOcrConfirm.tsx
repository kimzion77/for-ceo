'use client';

/**
 * MobileOcrConfirm — 모바일 "OCR 추출 내용 확인" 공용 화면 (원본 대조형).
 *
 * 디자이너 시안의 단어 단위 대조 UI:
 *   앱바(← + '추출된 내용 확인') · 안내 배너 ·
 *   [추출 텍스트]/[원본 이미지] 탭 토글(이미지가 있을 때만) ·
 *   확인 필요 카운터 · 종이 카드 본문(의심 단어 노란 하이라이트, 탭 → 수정 팝오버) ·
 *   전체 텍스트 직접 편집 폴백 · 하단 고정 CTA('이 내용으로 검토 시작').
 *
 * 4개 확인 페이지(근로계약서·임금명세서·노무제공자 계약서·취업규칙)가 공유한다.
 *
 * 원칙:
 *  - 텍스트 모델은 줄('\n') × 세그먼트(단어/공백) 2단 구조 — 공백 구분자도
 *    세그먼트로 보존해 join('') + join('\n') 만으로 원문을 정확히 복원
 *  - 실제 OCR 신뢰도 점수가 없으므로 텍스트 패턴 휴리스틱으로 '의심' 단어 표시
 *  - 의심 단어 탭 → 하단 미니시트 팝오버에서 수정/확인 → 초록('수정됨') 전환
 *  - 제출 시 onSubmit(전체 텍스트 복원본) — 부모 페이지가 분석 흐름을 이어받음
 */

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import styles from './MobileOcrConfirm.module.css';

export interface MobileOcrConfirmProps {
  initialText: string;
  submitting?: boolean;
  /** 수정 최종본 — 줄바꿈·공백을 보존해 복원한 전체 텍스트. */
  onSubmit: (editedText: string) => void;
  onBack: () => void;
  /** 기본값 '이 내용으로 검토 시작'. */
  submitLabel?: string;
  /** 직전 제출 실패 메시지 — CTA 위에 표시 (재시도 안내용, 선택). */
  errorMessage?: string;
  /** 안내 배너와 본문 사이에 끼우는 부가 콘텐츠 (예: AI 분류 확인 배너). */
  headerExtra?: ReactNode;
  /** 원본 이미지 URL — 있을 때만 [추출 텍스트]/[원본 이미지] 탭 토글 노출. */
  imageUrl?: string;
}

/* ─────────────────────────────────────────────
 *  단어 단위 의심 휴리스틱 (순수 함수)
 *  실제 신뢰도 점수가 없어 보수적 텍스트 패턴으로만 추정한다.
 * ───────────────────────────────────────────── */

export const SUSPECT_REASON_DATE = '날짜 일부가 비어 있어요';
export const SUSPECT_REASON_JAMO = '글자가 깨져 보일 수 있어요';
export const SUSPECT_REASON_UNREADABLE = '읽지 못한 글자가 있어요';

/**
 * 줄에 "숫자가 빠진 날짜 골격"이 있는지 — '년 / 월 / 일'·'/월/일'·'2025년 월 일' 류.
 * '매월 일정한'·'1년 월급'·'12월 31일' 같은 정상 문장은 잡지 않도록 보수적으로 판정.
 */
export function hasEmptyDateSkeleton(line: string): boolean {
  // 슬래시 바로 뒤(숫자 없이) 년/월/일 단위 — '계약일: / 월 / 일'
  if (/\/\s*[년월일]/.test(line)) return true;
  // 년·월 사이에 숫자가 없음 — '2025년 월 일'·'년/월'. 단 '월급' 같은 합성어 제외
  if (/년\s*\/?\s*월(?=[\s/일]|$)/.test(line)) return true;
  // 월·일 사이에 숫자가 없음 — 단독 토큰 연쇄 '월 일' ('매월 일정…'은 제외)
  if (/(^|[\s/])월\s*\/?\s*일(?=[\s/.,)]|$)/.test(line)) return true;
  return false;
}

/** 빈 날짜 골격을 이루는 토큰인지 — '2025년'·'년'·'월'·'일'·'/'·'/월/일' 등. */
function isEmptyDateToken(token: string): boolean {
  return /^(\d{0,4}년|[/년월일]+)$/.test(token);
}

/** 'ㄱ.'·'(ㄴ)' 같은 한글 자모 목록 기호 — 깨진 글자로 오인하지 않도록 제외. */
function isJamoListMarker(token: string): boolean {
  return /^[(（]?[ㄱ-ㅎ][)）.．]?$/.test(token);
}

/**
 * 단어 하나의 의심 사유 — 없으면 null.
 *  1) OCR 실패 마커 포함 — '□'·'�'·'??'·'불분명'·'판독불가'
 *  2) 단어 안에 깨진 한글 자모(ㄱ-ㅎ·ㅏ-ㅣ) — 목록 기호('ㄱ.')는 제외
 *  3) 줄에 빈 날짜 골격이 있고, 이 단어가 그 골격의 일부
 *  (희귀 음절 garble 휴리스틱은 오탐 위험이 커서 의도적으로 미적용)
 */
export function getTokenSuspicion(token: string, line: string): string | null {
  if (!token.trim()) return null;
  if (/[□�]|\?{2,}|불분명|판독불가/.test(token)) {
    return SUSPECT_REASON_UNREADABLE;
  }
  if (/[ㄱ-ㅎㅏ-ㅣ]/.test(token) && !isJamoListMarker(token)) {
    return SUSPECT_REASON_JAMO;
  }
  if (hasEmptyDateSkeleton(line) && isEmptyDateToken(token)) {
    return SUSPECT_REASON_DATE;
  }
  return null;
}

/* ─────────────────────────────────────────────
 *  텍스트 모델 — 줄 × 세그먼트(단어/공백)
 * ───────────────────────────────────────────── */

interface WordSegment {
  /** 현재 텍스트 (수정 반영). 공백 구분자도 그대로 담는다. */
  text: string;
  /** 공백 구분자 여부 — true 면 그대로 출력만. */
  ws: boolean;
  /** 의심 사유 — null 이면 평문. */
  reason: string | null;
  /** 사용자가 팝오버에서 수정(확인)함 — 초록 표시·카운터 제외. */
  fixed: boolean;
}

/** initialText → 모델. 공백 구분자를 세그먼트로 보존해 무손실 복원을 보장. */
function buildModel(text: string): WordSegment[][] {
  return text.split('\n').map((line) =>
    line
      .split(/(\s+)/) // 캡처 그룹 split — 구분자(연속 공백)도 배열에 남는다
      .filter((part) => part !== '')
      .map((part) => {
        const ws = /^\s+$/.test(part);
        return {
          text: part,
          ws,
          reason: ws ? null : getTokenSuspicion(part, line),
          fixed: false,
        };
      }),
  );
}

/** 모델 → 전체 텍스트 복원 — 세그먼트 join('') × 줄 join('\n'). */
function composeText(model: WordSegment[][]): string {
  return model.map((segs) => segs.map((s) => s.text).join('')).join('\n');
}

/** 렌더 최적화 — 평문(비의심) 연속 구간을 한 덩어리로 합친 렌더 단위. */
type RenderRun =
  | { kind: 'plain'; text: string }
  | { kind: 'word'; si: number; seg: WordSegment };

function toRenderRuns(segs: WordSegment[]): RenderRun[] {
  const runs: RenderRun[] = [];
  segs.forEach((seg, si) => {
    if (seg.reason) {
      runs.push({ kind: 'word', si, seg });
      return;
    }
    const last = runs[runs.length - 1];
    if (last && last.kind === 'plain') last.text += seg.text;
    else runs.push({ kind: 'plain', text: seg.text });
  });
  return runs;
}

/** 편집 textarea 높이를 내용에 맞게 자동 조절. */
function growTextarea(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function BackIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export default function MobileOcrConfirm({
  initialText,
  submitting = false,
  onSubmit,
  onBack,
  submitLabel = '이 내용으로 검토 시작',
  errorMessage,
  headerExtra,
  imageUrl,
}: MobileOcrConfirmProps) {
  // 줄 × 세그먼트 모델 — 빈 줄도 보존 (여백 줄로 렌더)
  const [model, setModel] = useState<WordSegment[][]>(() =>
    buildModel(initialText),
  );
  // [추출 텍스트] / [원본 이미지] 탭 — 이미지가 없으면 항상 'text'
  const [view, setView] = useState<'text' | 'image'>('text');
  // 팝오버 대상 세그먼트 좌표 (줄/세그먼트 인덱스)
  const [active, setActive] = useState<{ li: number; si: number } | null>(null);
  const [draft, setDraft] = useState('');
  // 전체 텍스트 직접 편집 폴백
  const [rawMode, setRawMode] = useState(false);
  const [rawDraft, setRawDraft] = useState('');
  // blur·리렌더 경합 없이 최신 직접편집본을 제출에 쓰기 위한 ref
  const rawDraftRef = useRef('');
  const popInputRef = useRef<HTMLInputElement | null>(null);
  const rawTaRef = useRef<HTMLTextAreaElement | null>(null);

  // initialText 가 마운트 후 바뀌는 드문 경우(스토어 비동기 복원) 동기화.
  const lastInitialRef = useRef(initialText);
  useEffect(() => {
    if (lastInitialRef.current === initialText) return;
    lastInitialRef.current = initialText;
    setModel(buildModel(initialText));
    setActive(null);
    setRawMode(false);
  }, [initialText]);

  // 팝오버 열릴 때 입력 포커스 + 전체 선택 (바로 덮어쓰기 쉽게)
  useEffect(() => {
    if (!active) return;
    const el = popInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [active]);

  // 직접 편집 진입 시 textarea 높이 맞춤
  useEffect(() => {
    if (!rawMode) return;
    const el = rawTaRef.current;
    if (el) growTextarea(el);
  }, [rawMode]);

  // 아직 안 고친 의심 단어 수 — 상태줄 카운터
  const suspectCount = useMemo(
    () =>
      model.reduce(
        (n, segs) =>
          n + segs.reduce((m, s) => m + (s.reason && !s.fixed ? 1 : 0), 0),
        0,
      ),
    [model],
  );

  // 렌더 단위 (평문 구간 병합) — 모델이 바뀔 때만 재계산
  const renderLines = useMemo(() => model.map(toRenderRuns), [model]);

  const activeSeg = active ? model[active.li]?.[active.si] : undefined;

  const openPopover = (li: number, si: number) => {
    if (submitting) return;
    const seg = model[li]?.[si];
    if (!seg) return;
    setDraft(seg.text);
    setActive({ li, si });
  };

  const closePopover = () => setActive(null);

  // [수정] — 단어 교체 + fixed 마킹 (값이 그대로여도 '확인함'으로 처리)
  const applyFix = () => {
    if (!active) return;
    const { li, si } = active;
    setModel((prev) =>
      prev.map((segs, i) =>
        i === li
          ? segs.map((seg, j) =>
              j === si ? { ...seg, text: draft, fixed: true } : seg,
            )
          : segs,
      ),
    );
    setActive(null);
  };

  // 전체 텍스트 직접 편집 토글 — 닫을 때 의심 휴리스틱을 다시 돌린다
  const toggleRawMode = () => {
    if (submitting) return;
    if (rawMode) {
      setModel(buildModel(rawDraftRef.current));
      setRawMode(false);
    } else {
      const full = composeText(model);
      setRawDraft(full);
      rawDraftRef.current = full;
      setActive(null);
      setRawMode(true);
    }
  };

  const handleSubmit = () => {
    if (submitting) return;
    // 직접 편집 중 제출 — textarea 최신본을 그대로 사용
    onSubmit(rawMode ? rawDraftRef.current : composeText(model));
  };

  const showTabs = Boolean(imageUrl);
  const showImage = showTabs && view === 'image';

  return (
    <div className={styles.root}>
      {/* 앱바 */}
      <header className={styles.appBar}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={onBack}
          aria-label="뒤로 가기"
        >
          <BackIcon />
        </button>
        <h1 className={styles.appBarTitle}>추출된 내용 확인</h1>
      </header>

      {/* 안내 배너 */}
      <div className={styles.banner}>
        <span className={styles.bannerIcon} aria-hidden>
          <InfoIcon />
        </span>
        <p className={styles.bannerText}>
          원본과 추출된 글자를 비교해 보세요.{' '}
          <strong>노란색으로 표시된 곳</strong>이 잘못 읽혔을 수 있어요. 탭해서
          고치면 됩니다.
        </p>
      </div>

      {/* 부가 콘텐츠 — 예: AI 1차 분류 확인 배너 */}
      {headerExtra && <div className={styles.headerExtra}>{headerExtra}</div>}

      {/* 탭 토글 — 원본 이미지가 있을 때만 */}
      {showTabs && (
        <div className={styles.tabs} role="tablist" aria-label="보기 전환">
          <button
            type="button"
            role="tab"
            aria-selected={!showImage}
            className={!showImage ? styles.tabActive : styles.tab}
            onClick={() => setView('text')}
          >
            추출 텍스트
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showImage}
            className={showImage ? styles.tabActive : styles.tab}
            onClick={() => setView('image')}
          >
            원본 이미지
          </button>
        </div>
      )}

      {/* 상태줄 — 남은 확인 필요 단어 수 */}
      {!rawMode && (
        <p className={styles.statusLine} role="status">
          {suspectCount > 0 ? (
            <>
              <span className={styles.statusWarn} aria-hidden>
                △
              </span>{' '}
              확인이 필요한 곳 <strong>{suspectCount}</strong> 군데 · 탭해서
              수정
            </>
          ) : (
            <>
              <span className={styles.statusOk} aria-hidden>
                ✓
              </span>{' '}
              확인이 필요한 곳이 없어요
            </>
          )}
        </p>
      )}

      {/* 본문 */}
      <div className={styles.body}>
        {showImage ? (
          /* ── 원본 이미지 모드 — 바운딩박스 정보가 없어 오버레이 없이 원본만 ── */
          <div className={styles.imagePane}>
            <p className={styles.imageCaption}>
              원본과 비교하며 추출 텍스트 탭에서 고쳐 주세요.
            </p>
            <div className={styles.imageScroll}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="업로드한 원본 문서"
                className={styles.image}
              />
            </div>
          </div>
        ) : rawMode ? (
          /* ── 전체 텍스트 직접 편집 폴백 ── */
          <div className={styles.rawPane}>
            <textarea
              ref={rawTaRef}
              className={styles.rawEditor}
              value={rawDraft}
              spellCheck={false}
              onChange={(e) => {
                setRawDraft(e.target.value);
                rawDraftRef.current = e.target.value;
                growTextarea(e.target);
              }}
              aria-label="전체 텍스트 직접 편집"
            />
            <button
              type="button"
              className={styles.rawToggle}
              onClick={toggleRawMode}
            >
              ✓ 직접 편집 완료 — 확인 필요한 곳 다시 찾기
            </button>
          </div>
        ) : (
          /* ── 추출 텍스트 모드 — 종이 카드 + 단어 하이라이트 ── */
          <>
            <div className={styles.paper}>
              {renderLines.map((runs, li) => (
                <p key={li} className={styles.paperLine}>
                  {runs.length === 0
                    ? ' ' /* 빈 줄 — 여백 보존 */
                    : runs.map((run, ri) => {
                        if (run.kind === 'plain') {
                          return <Fragment key={ri}>{run.text}</Fragment>;
                        }
                        const { seg, si } = run;
                        return (
                          <button
                            key={ri}
                            type="button"
                            className={
                              seg.fixed ? styles.wordFixed : styles.wordSuspect
                            }
                            onClick={() => openPopover(li, si)}
                            aria-label={
                              seg.fixed
                                ? `${seg.text} (수정됨) — 탭해서 다시 수정`
                                : `${seg.text} (잘못 읽혔을 수 있어요) — 탭해서 수정`
                            }
                          >
                            {seg.text}
                          </button>
                        );
                      })}
                </p>
              ))}
            </div>
            <button
              type="button"
              className={styles.rawToggle}
              onClick={toggleRawMode}
            >
              ✎ 전체 텍스트 직접 편집
            </button>
          </>
        )}
      </div>

      {/* 하단 고정 CTA */}
      <div className={styles.ctaBar}>
        {errorMessage && (
          <p className={styles.error} role="alert">
            {errorMessage}
          </p>
        )}
        <button
          type="button"
          className={styles.cta}
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? '준비 중…' : submitLabel}
        </button>
        <p className={styles.ctaCaption}>
          수정한 내용을 기준으로 노동법 위반 여부를 검토합니다
        </p>
      </div>

      {/* 단어 수정 팝오버 — 하단 미니시트 (좁은 화면에서도 잘리지 않음) */}
      {active && activeSeg && (
        <>
          <div
            className={styles.popBackdrop}
            onClick={closePopover}
            aria-hidden
          />
          <div
            className={styles.popSheet}
            role="dialog"
            aria-modal="true"
            aria-label="단어 수정"
          >
            <p className={styles.popHint}>
              <span className={styles.popHintIcon} aria-hidden>
                △
              </span>{' '}
              원본: {activeSeg.reason ?? '잘못 읽혔을 수 있어요'}
            </p>
            <input
              ref={popInputRef}
              className={styles.popInput}
              type="text"
              value={draft}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyFix();
                }
              }}
              aria-label="단어 수정 입력"
            />
            <div className={styles.popActions}>
              <button
                type="button"
                className={styles.popClose}
                onClick={closePopover}
              >
                닫기
              </button>
              <button
                type="button"
                className={styles.popFix}
                onClick={applyFix}
              >
                수정
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
