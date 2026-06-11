'use client';

/**
 * MobileOcrConfirm — 모바일 "OCR 추출 내용 확인" 공용 화면.
 *
 * 디자이너 시안의 추출 확인 단계 이식:
 *   앱바(← + '추출된 내용 확인') · 안내 배너 · 줄 단위 탭-수정 목록 ·
 *   하단 고정 CTA('이 내용으로 검토 시작').
 *
 * 4개 확인 페이지(근로계약서·임금명세서·노무제공자 계약서·취업규칙)가 공유한다.
 *
 * 원칙:
 *  - 추출 텍스트를 '\n' 으로 분할한 줄 단위 목록 — 탭하면 그 줄만 <textarea> 로 수정
 *  - 실제 OCR 신뢰도 점수가 없으므로 텍스트 패턴 휴리스틱으로 '의심' 줄 표시
 *  - 사용자가 의심 줄을 한 번이라도 수정하면(편집됨) 의심 표시는 사라짐
 *  - 제출 시 onSubmit(lines.join('\n')) — 부모 페이지가 분석 흐름을 이어받음
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import styles from './MobileOcrConfirm.module.css';

export interface MobileOcrConfirmProps {
  initialText: string;
  submitting?: boolean;
  /** 수정 최종본 — '\n' 으로 합친 전체 텍스트. */
  onSubmit: (editedText: string) => void;
  onBack: () => void;
  /** 기본값 '이 내용으로 검토 시작'. */
  submitLabel?: string;
  /** 직전 제출 실패 메시지 — CTA 위에 표시 (재시도 안내용, 선택). */
  errorMessage?: string;
  /** 안내 배너와 줄 목록 사이에 끼우는 부가 콘텐츠 (예: AI 분류 확인 배너). */
  headerExtra?: ReactNode;
}

/**
 * OCR 의심 줄 휴리스틱 — 실제 신뢰도 점수가 없어 텍스트 패턴으로 추정한다.
 *
 *  1) 비어있는 날짜 자리표시자 — '/ 월 / 일'·'년 / 월'·'월 / 일' 처럼
 *     숫자가 빠진 채 구분자(/)가 년·월·일 단위 바로 앞에 남은 형태
 *  2) OCR 실패 마커 포함 — '불분명'·'판독불가'·'□'·'�'·'??'
 *  3) 본문 중간에 공백 2개 이상 연속 (양식의 빈칸이 그대로 읽힌 흔적)
 *  4) 줄 전체가 1~2글자의 깨진 한글 자모 (ㄱ-ㅎ·ㅏ-ㅣ)
 */
export function isSuspiciousOcrLine(raw: string): boolean {
  const line = raw.trim();
  if (!line) return false; // 빈 줄은 단순 여백 — 의심 아님
  // 1) 숫자 없는 날짜 칸 — 슬래시 뒤에 숫자 대신 년/월/일 단위가 바로 옴
  if (/\/\s*[년월일]/.test(line)) return true;
  // 2) OCR 실패 마커
  if (/불분명|판독불가|□|�|\?\?/.test(line)) return true;
  // 3) 본문 중간 연속 공백 (trim 후이므로 내부 공백만 잡힘)
  if (/\S {2,}\S/.test(line)) return true;
  // 4) 깨진 자모 1~2글자
  if (/^[ㄱ-ㅎㅏ-ㅣ]{1,2}$/.test(line)) return true;
  return false;
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
}: MobileOcrConfirmProps) {
  // 줄 단위 상태 — 빈 줄도 보존 (얇은 여백 줄로 렌더, 탭하면 수정 가능)
  const [lines, setLines] = useState<string[]>(() => initialText.split('\n'));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editedSet, setEditedSet] = useState<Set<number>>(() => new Set());
  const [draft, setDraft] = useState('');
  // blur 커밋 ↔ CTA 클릭 경합 대비 — 최신 draft 를 ref 로도 보관
  const draftRef = useRef('');
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // initialText 가 마운트 후 바뀌는 드문 경우(스토어 비동기 복원) 동기화.
  const lastInitialRef = useRef(initialText);
  useEffect(() => {
    if (lastInitialRef.current === initialText) return;
    lastInitialRef.current = initialText;
    setLines(initialText.split('\n'));
    setEditedSet(new Set());
    setEditingIndex(null);
  }, [initialText]);

  // 편집 시작 시 포커스 + 캐럿 끝으로 + 높이 맞춤 (렌더마다 재실행 안 되도록 effect 로)
  useEffect(() => {
    if (editingIndex === null) return;
    const el = taRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    growTextarea(el);
  }, [editingIndex]);

  const beginEdit = (i: number) => {
    if (submitting) return;
    const v = lines[i] ?? '';
    setDraft(v);
    draftRef.current = v;
    setEditingIndex(i);
  };

  const commitEdit = () => {
    const cur = editingIndex;
    if (cur === null) return;
    const value = draftRef.current;
    const original = lines[cur] ?? '';
    if (value !== original) {
      // 붙여넣기 등으로 줄바꿈이 들어오면 줄을 분할해 번호 체계 유지
      const parts = value.split('\n');
      setLines((prev) => [
        ...prev.slice(0, cur),
        ...parts,
        ...prev.slice(cur + 1),
      ]);
      setEditedSet((prev) => {
        const next = new Set<number>();
        prev.forEach((idx) => {
          if (idx < cur) next.add(idx);
          else if (idx > cur) next.add(idx + parts.length - 1);
        });
        for (let k = 0; k < parts.length; k += 1) next.add(cur + k);
        return next;
      });
    }
    setEditingIndex(null);
  };

  const handleSubmit = () => {
    if (submitting) return;
    // 편집 중 제출 — blur 커밋과의 경합을 피해 draft 를 직접 합성
    const finalLines =
      editingIndex !== null
        ? [
            ...lines.slice(0, editingIndex),
            ...draftRef.current.split('\n'),
            ...lines.slice(editingIndex + 1),
          ]
        : lines;
    onSubmit(finalLines.join('\n'));
  };

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
          사진·스캔에서 글자를 읽어왔어요.{' '}
          <strong>잘못 읽힌 곳이 있으면 고쳐주세요.</strong> 정확한 검토를 위해
          필요해요.
        </p>
      </div>

      {/* 부가 콘텐츠 — 예: AI 1차 분류 확인 배너 */}
      {headerExtra && <div className={styles.headerExtra}>{headerExtra}</div>}

      {/* 줄 단위 목록 — 탭하면 그 줄만 수정 */}
      <div className={styles.lines}>
        {lines.map((line, i) => {
          const isEditing = editingIndex === i;
          const isEmpty = line.trim() === '';
          const suspect =
            !isEditing && !editedSet.has(i) && isSuspiciousOcrLine(line);

          if (isEditing) {
            return (
              <div key={i} className={styles.rowEditing}>
                <span className={styles.lineNo}>{i + 1}</span>
                <div className={styles.editorWrap}>
                  <textarea
                    ref={taRef}
                    className={styles.editor}
                    value={draft}
                    rows={1}
                    spellCheck={false}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      draftRef.current = e.target.value;
                      growTextarea(e.target);
                    }}
                    onBlur={commitEdit}
                    aria-label={`${i + 1}번째 줄 수정`}
                  />
                  <div className={styles.editActions}>
                    <button
                      type="button"
                      className={styles.doneBtn}
                      // mousedown 기본동작 차단 — blur 보다 클릭 커밋이 먼저 가게
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={commitEdit}
                    >
                      완료
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <button
              key={i}
              type="button"
              className={[
                styles.row,
                isEmpty ? styles.rowEmpty : '',
                suspect ? styles.rowSuspect : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => beginEdit(i)}
              aria-label={
                suspect
                  ? `${i + 1}번째 줄 (잘못 읽혔을 수 있어요) — 탭하여 수정`
                  : `${i + 1}번째 줄 — 탭하여 수정`
              }
            >
              <span className={styles.lineNo}>{i + 1}</span>
              <span className={styles.lineText}>{line}</span>
              {suspect && <span className={styles.suspectBadge}>의심</span>}
            </button>
          );
        })}
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
      </div>
    </div>
  );
}
