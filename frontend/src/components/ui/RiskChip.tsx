import { RISK, type RiskLevel } from '@/styles/tokens';
import styles from './RiskChip.module.css';

interface RiskChipProps {
  level: RiskLevel;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}

/** 위험도 필터 칩 (시안 `RiskChip`). */
export function RiskChip({ level, count, active = false, onClick }: RiskChipProps) {
  const r = RISK[level];
  if (!r) return null;

  const activeStyle = active
    ? {
        background: r.soft,
        color: r.text,
        borderColor: r.border,
      }
    : undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.chip} ${active ? styles.active : ''}`}
      style={activeStyle}
    >
      <span className={styles.dot} style={{ background: r.solid }} />
      {r.label}
      {typeof count === 'number' && (
        <span
          className={styles.count}
          style={active ? { color: r.text, borderColor: r.border } : undefined}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default RiskChip;
