import type { CSSProperties, ReactNode } from 'react';

/**
 * Icon — 스트로크 기반 24px viewBox SVG.
 * 시안 `components.jsx::Icon` 동일 셋.
 */
export type IconName =
  | 'upload'
  | 'file'
  | 'doc'
  | 'contract'
  | 'receipt'
  | 'check'
  | 'x'
  | 'alert'
  | 'warn'
  | 'info'
  | 'book'
  | 'scale'
  | 'quote'
  | 'edit'
  | 'arrow'
  | 'chevron'
  | 'chevronD'
  | 'download'
  | 'print'
  | 'share'
  | 'search'
  | 'filter'
  | 'loader'
  | 'spark'
  | 'chart'
  | 'user'
  | 'shield'
  | 'plus'
  | 'minus'
  | 'sparkle'
  | 'menu'
  | 'flag'
  | 'target';

const PATHS: Record<IconName, ReactNode> = {
  upload: (
    <>
      <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </>
  ),
  doc: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  contract: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h6" />
      <path d="M14 17l2 2 3-3" />
    </>
  ),
  receipt: (
    <>
      <path d="M5 3h14v18l-3-2-3 2-3-2-3 2-2-2V3z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  check: <path d="M5 12l4 4 10-10" />,
  x: <path d="M6 6l12 12M18 6l-12 12" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 17v.01" />
    </>
  ),
  warn: (
    <>
      <path d="M12 3l10 17H2L12 3z" />
      <path d="M12 10v5M12 18v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </>
  ),
  book: (
    <>
      <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2V5z" />
      <path d="M4 17a2 2 0 0 1 2-2h12" />
    </>
  ),
  scale: (
    <>
      <path d="M12 3v18M5 7h14" />
      <path d="M5 7l-3 7a3 3 0 0 0 6 0L5 7zM19 7l-3 7a3 3 0 0 0 6 0l-3-7z" />
    </>
  ),
  quote: (
    <>
      <path d="M7 7h4v4H7zM13 7h4v4h-4z" />
      <path d="M7 11c0 3-2 5-2 5M13 11c0 3-2 5-2 5" />
    </>
  ),
  edit: <path d="M14 4l6 6L9 21H3v-6L14 4z" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  chevronD: <path d="M6 9l6 6 6-6" />,
  download: (
    <>
      <path d="M12 4v12M12 16l-4-4M12 16l4-4" />
      <path d="M4 20h16" />
    </>
  ),
  print: (
    <>
      <path d="M6 9V3h12v6" />
      <rect x="4" y="9" width="16" height="8" rx="1" />
      <path d="M6 17v4h12v-4" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8.5 11l7-4M8.5 13l7 4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4" />
    </>
  ),
  filter: <path d="M4 5h16M7 12h10M10 19h4" />,
  loader: (
    <>
      <circle cx="12" cy="12" r="9" opacity=".25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </>
  ),
  spark: <path d="M12 3l2 6 6 1-4.5 4 1 6-5-3-5 3 1-6L3 10l6-1z" />,
  chart: (
    <>
      <path d="M4 19V5M4 19h16" />
      <path d="M8 15l3-4 3 2 5-7" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4 4-6 8-6s7 2 8 6" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  sparkle: <path d="M12 4l1.5 4.5L18 10l-4.5 1.5L12 16l-1.5-4.5L6 10l4.5-1.5z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  flag: <path d="M5 21V4M5 4h12l-2 4 2 4H5" />,
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
  'aria-hidden'?: boolean;
}

export function Icon({
  name,
  size = 18,
  color = 'currentColor',
  strokeWidth = 1.8,
  style,
  className,
  'aria-hidden': ariaHidden = true,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden={ariaHidden}
    >
      {PATHS[name] ?? null}
    </svg>
  );
}

export default Icon;
