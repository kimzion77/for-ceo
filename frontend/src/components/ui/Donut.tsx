import { RISK, RISK_ORDER, type RiskLevel } from '@/styles/tokens';

type Counts = Partial<Record<RiskLevel, number>>;

interface DonutProps {
  counts: Counts;
  size?: number;
  thickness?: number;
  /**
   * 옅게 표시할 키 — 전체 분포는 보여주되 다른 segment 가 도드라지도록
   * 채도를 낮춘다 (opacity 0.28).
   *
   * 예: 시정 항목을 강조하고 싶을 때 `mutedKeys={['ok']}`.
   */
  mutedKeys?: RiskLevel[];
}

/** 도넛 차트 — 위험도 분포 시각화. */
export function Donut({
  counts,
  size = 160,
  thickness = 18,
  mutedKeys,
}: DonutProps) {
  const muted = new Set<RiskLevel>(mutedKeys ?? []);
  const total = RISK_ORDER.reduce((acc, k) => acc + (counts[k] ?? 0), 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ transform: 'rotate(-90deg)' }}
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#F3F4F6"
        strokeWidth={thickness}
      />
      {RISK_ORDER.map((k) => {
        const v = counts[k] ?? 0;
        if (v <= 0) return null;
        const len = (v / total) * c;
        const isMuted = muted.has(k);
        const seg = (
          <circle
            key={k}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={RISK[k].solid}
            strokeOpacity={isMuted ? 0.28 : 1}
            strokeWidth={thickness}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
          />
        );
        offset += len;
        return seg;
      })}
    </svg>
  );
}

export default Donut;
