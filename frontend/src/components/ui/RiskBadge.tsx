import { RISK, type RiskLevel } from '@/styles/tokens';
import styles from './RiskBadge.module.css';

interface RiskBadgeProps {
  level: RiskLevel;
  size?: 'sm' | 'md';
  showEn?: boolean;
}

/** 솔리드 위험도 배지 (시안 `RiskBadge`). */
export function RiskBadge({ level, size = 'md', showEn = true }: RiskBadgeProps) {
  const r = RISK[level];
  if (!r) return null;

  return (
    <span
      className={`${styles.badge} ${styles[size]}`}
      style={{ background: r.solid, color: r.on }}
    >
      <span className={styles.dot} />
      {r.label}
      {showEn && <span className={styles.en}>{r.en}</span>}
    </span>
  );
}

export default RiskBadge;
