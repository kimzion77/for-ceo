import type { ReactNode } from 'react';
import styles from './Quote.module.css';

interface QuoteProps {
  children: ReactNode;
  label?: string;
  lineNo?: string | number;
}

/** 사업장 본문 인용 블록 (시안 `Quote`). */
export function Quote({ children, label = '사업장 취업규칙 본문', lineNo }: QuoteProps) {
  return (
    <div className={styles.quote}>
      <div className={styles.header}>
        <span>📌 {label}</span>
        {lineNo && <span className={styles.lineNo}>제{lineNo}</span>}
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}

export default Quote;
