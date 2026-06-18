'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import Icon from '@/components/ui/Icon';

import styles from './FileDropzone.module.css';

// 문서 MIME — 모바일 파일앱이 '확장자'만으로는 docx/hwp 를 잘 못 거르므로
// 표준 MIME 을 함께 줘야 '파일' 브라우저에서 문서가 보인다.
const DOC_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'text/plain',
];
const DOC_EXT = ['.docx', '.hwp', '.hwpx', '.pdf', '.txt'];
const IMG_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.webp'];

// 데스크톱(드래그·찾아보기) — 확장자만. Windows 파일 대화상자는 MIME 타입을
// 섞으면 일부 형식(예: PNG)을 기본 필터에서 빼버려 '모든 파일'로 바꿔야 보였다.
// 확장자만 나열하면 모든 형식이 기본 필터에 그대로 노출된다.
const ACCEPT_ALL = [...DOC_EXT, ...IMG_EXT].join(',');
// 모바일 '문서 파일' — 이미지 타입을 빼야 OS 가 갤러리 대신 '파일' 브라우저를
// 열어 docx·hwp·pdf 가 보인다 (이미지가 섞이면 일부 기기는 갤러리만 띄움).
const ACCEPT_DOCS = [...DOC_MIME, ...DOC_EXT].join(',');
// 모바일 '촬영/사진' — 이미지 전용.
const ACCEPT_IMAGE = ['image/*', ...IMG_EXT].join(',');

const ALLOWED_EXT = [
  '.docx', '.hwp', '.hwpx', '.pdf', '.txt',
  // 스캔본 — Vision OCR 로 텍스트화한 뒤 동일 파이프라인
  ...IMG_EXT,
];
const MAX_MB_PER_FILE = 200;
const MAX_FILES = 20;

/** ≤720px 뷰포트 감지 — 모바일에서 촬영/파일 선택 버튼을 분리해 띄운다. */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 720px)');
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);
  return mobile;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function fileExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

/** 두 파일이 사실상 동일한지 (이름·크기·수정시각). */
function sameFile(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

interface FileDropzoneProps {
  value: File[];
  onChange: (next: File[]) => void;
}

/**
 * 다중 파일 업로드 드롭존.
 *
 * - 드래그&드롭 또는 클릭으로 파일 추가
 * - 같은 파일은 중복 제거 (이름·크기·수정시각 기준)
 * - 개별 파일 [✕] 제거 + [모두 지우기]
 * - 총 N개 / 합계 사이즈 표시
 */
export function FileDropzone({ value, onChange }: FileDropzoneProps) {
  // 입력 분리: 데스크톱(전체) · 모바일 사진(촬영·갤러리 겸용) · 모바일 문서.
  // 사진 입력은 capture 를 빼서 OS 가 '촬영 / 보관함(여러 장)' 선택지를 모두
  // 띄우게 하고 multiple 로 여러 장을 한 번에 고를 수 있게 한다.
  const inputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const docsRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const flashErrors = (msgs: string[]) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setErrors(msgs);
    errorTimerRef.current = setTimeout(() => setErrors([]), 6000);
  };

  const openPicker = () => inputRef.current?.click();
  const openImage = () => imageRef.current?.click();
  const openDocs = () => docsRef.current?.click();

  const addFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming || incoming.length === 0) return;

      const merged: File[] = [...value];
      const skipped: string[] = [];

      Array.from(incoming).forEach((f) => {
        const ext = fileExt(f.name);
        if (!ALLOWED_EXT.includes(ext)) {
          skipped.push(
            `❌ ${f.name} — 지원하지 않는 형식 (${ext || '확장자 없음'}). DOCX·HWP·PDF·TXT·PNG·JPG 만 가능합니다.`,
          );
          return;
        }
        if (f.size === 0) {
          skipped.push(`❌ ${f.name} — 빈 파일입니다 (0 bytes).`);
          return;
        }
        if (f.size > MAX_MB_PER_FILE * 1024 * 1024) {
          skipped.push(
            `❌ ${f.name} — 파일 크기가 너무 큽니다 (${humanSize(f.size)} / 최대 ${MAX_MB_PER_FILE}MB).`,
          );
          return;
        }
        if (merged.some((x) => sameFile(x, f))) {
          skipped.push(`⚠ ${f.name} — 이미 추가된 파일입니다.`);
          return;
        }
        merged.push(f);
      });

      if (merged.length > MAX_FILES) {
        skipped.push(
          `⚠ 최대 ${MAX_FILES}개까지만 업로드할 수 있어요. 일부만 추가됩니다.`,
        );
        merged.length = MAX_FILES;
      }

      if (skipped.length > 0) {
        flashErrors(skipped);
      } else {
        setErrors([]);
      }

      onChange(merged);

      // 같은 파일을 다시 선택할 수 있도록 input 비움
      if (inputRef.current) inputRef.current.value = '';
    },
    [onChange, value],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  };
  const onDragLeave = () => setDragOver(false);

  const removeAt = (e: ReactMouseEvent, idx: number) => {
    e.stopPropagation();
    onChange(value.filter((_, i) => i !== idx));
  };

  const clearAll = (e: ReactMouseEvent) => {
    e.stopPropagation();
    onChange([]);
    [inputRef, imageRef, docsRef].forEach((r) => {
      if (r.current) r.current.value = '';
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  };

  const empty = value.length === 0;
  const totalSize = value.reduce((acc, f) => acc + f.size, 0);

  const zoneClass = [
    styles.zone,
    dragOver && styles.zoneActive,
    !empty && styles.zoneFilled,
    // 모바일 빈 상태 — 3-버튼만 보이므로 점선 박스·큰 패딩 제거
    isMobile && empty && styles.zonePlain,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.wrap}>
      {errors.length > 0 && (
        <div className={styles.errorBox} role="alert" aria-live="polite">
          {errors.map((msg, i) => (
            <div key={i} className={styles.errorLine}>
              {msg}
            </div>
          ))}
          <button
            type="button"
            className={styles.errorClose}
            onClick={() => setErrors([])}
            aria-label="알림 닫기"
          >
            ✕
          </button>
        </div>
      )}
    <div
      className={zoneClass}
      onClick={isMobile ? undefined : openPicker}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      role={isMobile ? undefined : 'button'}
      tabIndex={isMobile ? undefined : 0}
      onKeyDown={isMobile ? undefined : onKeyDown}
      aria-label="파일 업로드 영역"
    >
      {/* 데스크톱(전체) — 드래그·찾아보기 */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ALL}
        multiple
        className={styles.hiddenInput}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {/* 모바일 사진 — capture 없이 image/* + multiple → '촬영 / 보관함(여러 장)' 모두 */}
      <input
        ref={imageRef}
        type="file"
        accept={ACCEPT_IMAGE}
        multiple
        className={styles.hiddenInput}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {/* 모바일 문서 파일 — 이미지 제외 → '파일' 브라우저에서 docx·hwp·pdf 노출 */}
      <input
        ref={docsRef}
        type="file"
        accept={ACCEPT_DOCS}
        multiple
        className={styles.hiddenInput}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {empty ? (
        isMobile ? (
          <div className={styles.mobilePick}>
            <button
              type="button"
              className={styles.pickBtn}
              onClick={(e) => {
                e.stopPropagation();
                openImage();
              }}
            >
              <span className={styles.pickEmoji} aria-hidden>📷</span>
              <span className={styles.pickText}>
                <span className={styles.pickLabel}>사진</span>
                <span className={styles.pickSub}>촬영하거나 여러 장 선택</span>
              </span>
            </button>
            <button
              type="button"
              className={styles.pickBtn}
              onClick={(e) => {
                e.stopPropagation();
                openDocs();
              }}
            >
              <span className={styles.pickEmoji} aria-hidden>📁</span>
              <span className={styles.pickText}>
                <span className={styles.pickLabel}>문서 파일</span>
                <span className={styles.pickSub}>DOCX·HWP·PDF·TXT</span>
              </span>
            </button>
          </div>
        ) : (
        <div className={styles.emptyInner}>
          <Icon name="upload" size={32} color="var(--color-text-muted)" />
          <div className={styles.label}>
            파일을 끌어다 놓거나 <span className={styles.link}>찾아보기</span>
          </div>
          <div className={styles.help}>
            DOCX · HWP · HWPX · PDF · TXT · PNG · JPG · 파일당 최대 {MAX_MB_PER_FILE}MB · 한 번에 {MAX_FILES}개까지
          </div>
        </div>
        )
      ) : (
        <div className={styles.filledInner}>
          <ul className={styles.list}>
            {value.map((f, i) => (
              <li key={`${f.name}-${f.size}-${f.lastModified}-${i}`} className={styles.item}>
                <span className={styles.fileIcon}>
                  <Icon name="file" size={18} />
                </span>
                <div className={styles.fileInfo}>
                  <div className={styles.fileName}>{f.name}</div>
                  <div className={styles.fileMeta}>{humanSize(f.size)}</div>
                </div>
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={(e) => removeAt(e, i)}
                  aria-label={`${f.name} 제거`}
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>

          <div className={styles.footer}>
            <div className={styles.summary}>
              총 <strong>{value.length}개</strong> · {humanSize(totalSize)}
            </div>
            <div className={styles.footerActions}>
              <button type="button" className={styles.clearBtn} onClick={clearAll}>
                모두 지우기
              </button>
              <button
                type="button"
                className={styles.addBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isMobile) openDocs();
                  else openPicker();
                }}
              >
                <Icon name="plus" size={12} />
                파일 추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

export default FileDropzone;
