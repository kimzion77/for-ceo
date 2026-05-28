/**
 * 디자인 토큰 — 취업규칙 검토 AI
 *
 * 시안의 `취업규칙프론트엔드/tokens.jsx` 를 TypeScript 로 이식.
 * `civic` 팔레트를 기본으로 globals.css 의 CSS 변수와 동기화한다.
 */

/**
 * 위험도 키 — 백엔드 `cgr/verdict.classify()` 의 5-Bucket + 선택조항.
 *
 * 매핑:
 *  - missing   = 누락   (본문에 규정 자체가 없음 — 강행)
 *  - violation = 위반   (본문 있으나 법정 기준 미달 — 강행)
 *  - warn      = 주의   (임의·확인적 규정 미준수)
 *  - ambiguous = 검토필요 (매칭 모호)
 *  - ok        = 적정
 *  - skipped   = 선택   (사업장 정보로 검사 제외 — 별도 영역)
 */
export type RiskLevel =
  | 'missing'
  | 'violation'
  | 'warn'
  | 'ambiguous'
  | 'ok'
  | 'skipped';

export interface RiskPaletteEntry {
  label: string;
  en: string;
  solid: string;
  soft: string;
  on: string;
  text: string;
  border: string;
}

export interface ColorPalette {
  name: string;
  bg: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  brand: string;
  brandSoft: string;
  brandStrong: string;
  accent: string;
  focus: string;
}

export const PALETTES: Record<'civic' | 'warm' | 'soft', ColorPalette> = {
  // ① 정통 공공(Civic Navy) — 정부24 톤 (기본)
  civic: {
    name: '정통 공공',
    bg: '#F5F7FA',
    surface: '#FFFFFF',
    surfaceMuted: '#EEF2F6',
    border: '#DBE2EA',
    borderStrong: '#C2CCD8',
    text: '#0F1B2D',
    textMuted: '#475569',
    textSubtle: '#7B8794',
    brand: '#0B3D91',
    brandSoft: '#E5ECF8',
    brandStrong: '#08306E',
    accent: '#1D6FE0',
    focus: '#1D6FE0',
  },
  // ② 친근 공공(Warm Civic)
  warm: {
    name: '친근 공공',
    bg: '#F7F4EE',
    surface: '#FFFFFF',
    surfaceMuted: '#F0EBE1',
    border: '#E2DACA',
    borderStrong: '#C9BFA8',
    text: '#1F2937',
    textMuted: '#52606D',
    textSubtle: '#7C8693',
    brand: '#1F5FA8',
    brandSoft: '#E6EEF8',
    brandStrong: '#16467E',
    accent: '#C2410C',
    focus: '#1F5FA8',
  },
  // ③ 소프트 시빅
  soft: {
    name: '소프트 시빅',
    bg: '#FAFAF7',
    surface: '#FFFFFF',
    surfaceMuted: '#F2F0EC',
    border: '#E5E2DB',
    borderStrong: '#CFCBC1',
    text: '#1A1A1A',
    textMuted: '#5A5A5A',
    textSubtle: '#8A8A8A',
    brand: '#2B6BD8',
    brandSoft: '#EAF1FC',
    brandStrong: '#1F4FA8',
    accent: '#2B6BD8',
    focus: '#2B6BD8',
  },
};

/**
 * 색 값은 백엔드 `cgr/ui/constants.py::BUCKET_COLORS` 와 1:1 일치.
 * 변경 시 양쪽을 동시에 수정해 색상이 어긋나지 않게 한다.
 */
export const RISK: Record<RiskLevel, RiskPaletteEntry> = {
  missing:   { label: '누락',     en: 'MISSING',   solid: '#dc2626', soft: '#fee2e2', on: '#ffffff', text: '#991b1b', border: '#fca5a5' },
  violation: { label: '위반',     en: 'VIOLATION', solid: '#ea580c', soft: '#ffedd5', on: '#ffffff', text: '#9a3412', border: '#fdba74' },
  warn:      { label: '주의',     en: 'WARN',      solid: '#facc15', soft: '#fef9c3', on: '#1f2937', text: '#854d0e', border: '#fde047' },
  ambiguous: { label: '검토필요', en: 'AMBIGUOUS', solid: '#a855f7', soft: '#f3e8ff', on: '#ffffff', text: '#6b21a8', border: '#d8b4fe' },
  ok:        { label: '적정',     en: 'OK',        solid: '#22c55e', soft: '#d1fae5', on: '#ffffff', text: '#065f46', border: '#6ee7b7' },
  skipped:   { label: '선택',     en: 'SKIPPED',   solid: '#6b7280', soft: '#f3f4f6', on: '#ffffff', text: '#374151', border: '#d1d5db' },
};

/** 도넛·분포 막대·필터 등에 사용되는 순서. 선택조항은 별도 영역이라 제외. */
export const RISK_ORDER: RiskLevel[] = [
  'missing',
  'violation',
  'warn',
  'ambiguous',
  'ok',
];

export const TYPO = {
  family:
    '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  mono: '"D2Coding", "JetBrains Mono", ui-monospace, monospace',
  sizes: {
    display: 32,
    h1: 26,
    h2: 20,
    h3: 17,
    body: 15,
    small: 13,
    caption: 12,
  },
  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
  },
  lineHeights: { tight: 1.25, base: 1.55, loose: 1.75 },
} as const;

export const SPACE = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 32,
  8: 40,
  9: 56,
  10: 72,
} as const;

export const RADIUS = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

export const SHADOW = {
  sm: '0 1px 2px rgba(15, 27, 45, 0.04), 0 1px 1px rgba(15, 27, 45, 0.03)',
  md: '0 2px 8px rgba(15, 27, 45, 0.06), 0 1px 2px rgba(15, 27, 45, 0.04)',
  lg: '0 12px 32px rgba(15, 27, 45, 0.10), 0 4px 8px rgba(15, 27, 45, 0.04)',
  focus: '0 0 0 3px rgba(29, 111, 224, 0.25)',
} as const;

/** 기본 팔레트 — globals.css 의 CSS 변수와 일치한다. */
export const DEFAULT_PALETTE = PALETTES.civic;

/** 시안의 `T.palettes.civic` 호환을 위한 alias. */
export const TOKENS = {
  palettes: PALETTES,
  risk: RISK,
  type: TYPO,
  space: SPACE,
  radius: RADIUS,
  shadow: SHADOW,
} as const;
