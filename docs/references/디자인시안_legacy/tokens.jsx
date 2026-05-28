/* 디자인 토큰 — 취업규칙 검토 AI */

const TOKENS = {
  // 색상 톤은 3가지 (Tweaks로 전환)
  palettes: {
    // ① 정통 공공(Civic Navy) — 정부24 톤
    civic: {
      name: "정통 공공",
      bg: "#F5F7FA",
      surface: "#FFFFFF",
      surfaceMuted: "#EEF2F6",
      border: "#DBE2EA",
      borderStrong: "#C2CCD8",
      text: "#0F1B2D",
      textMuted: "#475569",
      textSubtle: "#7B8794",
      brand: "#0B3D91",       // 진한 공공 네이비
      brandSoft: "#E5ECF8",
      brandStrong: "#08306E",
      accent: "#1D6FE0",
      focus: "#1D6FE0",
    },
    // ② 친근 공공(Warm Civic) — 노동권리찾기 톤
    warm: {
      name: "친근 공공",
      bg: "#F7F4EE",
      surface: "#FFFFFF",
      surfaceMuted: "#F0EBE1",
      border: "#E2DACA",
      borderStrong: "#C9BFA8",
      text: "#1F2937",
      textMuted: "#52606D",
      textSubtle: "#7C8693",
      brand: "#1F5FA8",
      brandSoft: "#E6EEF8",
      brandStrong: "#16467E",
      accent: "#C2410C",      // 따뜻한 액센트
      focus: "#1F5FA8",
    },
    // ③ 블루 + 따뜻 그레이 — 토스/카뱅 일부 차용
    soft: {
      name: "소프트 시빅",
      bg: "#FAFAF7",
      surface: "#FFFFFF",
      surfaceMuted: "#F2F0EC",
      border: "#E5E2DB",
      borderStrong: "#CFCBC1",
      text: "#1A1A1A",
      textMuted: "#5A5A5A",
      textSubtle: "#8A8A8A",
      brand: "#2B6BD8",
      brandSoft: "#EAF1FC",
      brandStrong: "#1F4FA8",
      accent: "#2B6BD8",
      focus: "#2B6BD8",
    },
  },
  // 위험도 — 모든 팔레트에 공유
  risk: {
    critical: { label: "심각", en: "CRITICAL", solid: "#DC2626", soft: "#FEE2E2", on: "#FFFFFF", text: "#991B1B", border: "#FCA5A5" },
    high:     { label: "주의", en: "HIGH",     solid: "#EA580C", soft: "#FFEDD5", on: "#FFFFFF", text: "#9A3412", border: "#FDBA74" },
    medium:   { label: "보통", en: "MEDIUM",   solid: "#D97706", soft: "#FEF3C7", on: "#FFFFFF", text: "#92400E", border: "#FCD34D" },
    low:      { label: "경미", en: "LOW",      solid: "#2563EB", soft: "#DBEAFE", on: "#FFFFFF", text: "#1E40AF", border: "#93C5FD" },
    ambiguous:{ label: "모호", en: "AMBIGUOUS",solid: "#7C3AED", soft: "#EDE9FE", on: "#FFFFFF", text: "#5B21B6", border: "#C4B5FD" },
    ok:       { label: "적정", en: "OK",       solid: "#059669", soft: "#D1FAE5", on: "#FFFFFF", text: "#065F46", border: "#6EE7B7" },
    skipped:  { label: "선택", en: "SKIPPED",  solid: "#6B7280", soft: "#F3F4F6", on: "#FFFFFF", text: "#374151", border: "#D1D5DB" },
  },
  // 타이포 (Pretendard 기반)
  type: {
    family: `"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`,
    mono: `"D2Coding", "JetBrains Mono", ui-monospace, monospace`,
    sizes: {
      display: 32,
      h1: 26,
      h2: 20,
      h3: 17,
      body: 15,
      small: 13,
      caption: 12,
    },
    weights: { regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 },
    lineHeights: { tight: 1.25, base: 1.55, loose: 1.75 },
  },
  // 간격
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 32, 8: 40, 9: 56, 10: 72 },
  // 라운드
  radius: { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 },
  // 그림자
  shadow: {
    sm: "0 1px 2px rgba(15, 27, 45, 0.04), 0 1px 1px rgba(15, 27, 45, 0.03)",
    md: "0 2px 8px rgba(15, 27, 45, 0.06), 0 1px 2px rgba(15, 27, 45, 0.04)",
    lg: "0 12px 32px rgba(15, 27, 45, 0.10), 0 4px 8px rgba(15, 27, 45, 0.04)",
    focus: "0 0 0 3px rgba(29, 111, 224, 0.25)",
  },
};

window.TOKENS = TOKENS;
