import type { ReactNode } from 'react';
import styles from './SectionHeading.module.css';

interface SectionHeadingProps {
  step: number;
  title: string;
  /** 우측 hint (오른쪽 정렬). */
  hint?: ReactNode;
  /** 왼쪽에 붙는 hint. */
  hintInline?: ReactNode;
}

export function SectionHeading({ step, title, hint, hintInline }: SectionHeadingProps) {
  return (
    <div className={styles.row}>
      <span className={styles.step}>{step}</span>
      <h2 className={styles.title}>{title}</h2>
      {hintInline && <span className={styles.hintInline}>{hintInline}</span>}
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}

export default SectionHeading;
