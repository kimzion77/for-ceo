import { RISK, RISK_ORDER, type RiskLevel } from '@/styles/tokens';
import styles from './RiskDistributionBar.module.css';

type Counts = Partial<Record<RiskLevel, number>>;

interface RiskDistributionBarProps {
  counts: Counts;
  height?: number;
}

/** 위험도 분포 막대 (시안 `RiskDistributionBar`). */
export function RiskDistributionBar({ counts, height = 14 }: RiskDistributionBarProps) {
  const total = RISK_ORDER.reduce((acc, k) => acc + (counts[k] ?? 0), 0) || 1;

  return (
    <div className={styles.bar} style={{ height }}>
      {RISK_ORDER.map((k) => {
        const v = counts[k] ?? 0;
        if (v <= 0) return null;
        return (
          <div
            key={k}
            className={styles.seg}
            style={{
              width: `${(v / total) * 100}%`,
              background: RISK[k].solid,
            }}
            title={`${RISK[k].label}: ${v}`}
          />
        );
      })}
    </div>
  );
}

export default RiskDistributionBar;
