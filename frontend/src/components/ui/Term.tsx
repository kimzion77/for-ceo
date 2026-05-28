'use client';

import { useRef, useState, type ReactNode } from 'react';
import styles from './Term.module.css';

interface TermProps {
  children: ReactNode;
  def: ReactNode;
  /** 호버 해제 후 닫히기까지 유지 시간 (ms). 기본 280ms. */
  hideDelay?: number;
  /** 툴팁 너비(px). 길이가 긴 설명에 사용. */
  width?: number;
}

/**
 * 용어 툴팁 (시안 `Term`).
 *
 * - 호버/포커스 시 즉시 표시
 * - 마우스가 벗어나면 `hideDelay` 이후 닫힘 (살짝 벗어나도 깜빡이지 않음)
 * - 툴팁 본문 위로 마우스를 옮기면 다시 열림 유지 (긴 글을 읽을 수 있음)
 */
export function Term({ children, def, hideDelay = 280, width = 280 }: TermProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const show = () => {
    cancelClose();
    setOpen(true);
  };

  const scheduleClose = () => {
    cancelClose();
    timer.current = setTimeout(() => setOpen(false), hideDelay);
  };

  return (
    <span
      className={styles.wrap}
      onMouseEnter={show}
      onMouseLeave={scheduleClose}
      onFocus={show}
      onBlur={scheduleClose}
      tabIndex={0}
    >
      {children}
      <span className={styles.badge} aria-hidden>
        i
      </span>
      {open && (
        <span
          className={styles.tip}
          style={{ '--cgr-tip-width': `${width}px` } as React.CSSProperties}
          role="tooltip"
          onMouseEnter={show}
          onMouseLeave={scheduleClose}
        >
          {def}
        </span>
      )}
    </span>
  );
}

export default Term;
