/* 공용 UI 컴포넌트 — 취업규칙 검토 AI */

const T = window.TOKENS;

// ─────────────────────────────────────────────
// 아이콘 (스트로크 기반, 24px viewBox)
// ─────────────────────────────────────────────
const Icon = ({ name, size = 18, color = "currentColor", strokeWidth = 1.8, style }) => {
  const paths = {
    upload: <><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></>,
    file:   <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></>,
    doc:    <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    contract:<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h6"/><path d="M14 17l2 2 3-3"/></>,
    receipt:<><path d="M5 3h14v18l-3-2-3 2-3-2-3 2-2-2V3z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    check:  <><path d="M5 12l4 4 10-10"/></>,
    x:      <><path d="M6 6l12 12M18 6l-12 12"/></>,
    alert:  <><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17v.01"/></>,
    warn:   <><path d="M12 3l10 17H2L12 3z"/><path d="M12 10v5M12 18v.01"/></>,
    info:   <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></>,
    book:   <><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2V5z"/><path d="M4 17a2 2 0 0 1 2-2h12"/></>,
    scale:  <><path d="M12 3v18M5 7h14"/><path d="M5 7l-3 7a3 3 0 0 0 6 0L5 7zM19 7l-3 7a3 3 0 0 0 6 0l-3-7z"/></>,
    quote:  <><path d="M7 7h4v4H7zM13 7h4v4h-4z"/><path d="M7 11c0 3-2 5-2 5M13 11c0 3-2 5-2 5"/></>,
    edit:   <><path d="M14 4l6 6L9 21H3v-6L14 4z"/></>,
    arrow:  <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    chevron:<><path d="M9 6l6 6-6 6"/></>,
    chevronD:<><path d="M6 9l6 6 6-6"/></>,
    download:<><path d="M12 4v12M12 16l-4-4M12 16l4-4"/><path d="M4 20h16"/></>,
    print:  <><path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="1"/><path d="M6 17v4h12v-4"/></>,
    share:  <><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 11l7-4M8.5 13l7 4"/></>,
    search: <><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></>,
    filter: <><path d="M4 5h16M7 12h10M10 19h4"/></>,
    loader: <><circle cx="12" cy="12" r="9" opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/></>,
    spark:  <><path d="M12 3l2 6 6 1-4.5 4 1 6-5-3-5 3 1-6L3 10l6-1z"/></>,
    chart:  <><path d="M4 19V5M4 19h16"/><path d="M8 15l3-4 3 2 5-7"/></>,
    user:   <><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></>,
    shield: <><path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3z"/></>,
    plus:   <><path d="M12 5v14M5 12h14"/></>,
    minus:  <><path d="M5 12h14"/></>,
    sparkle:<><path d="M12 4l1.5 4.5L18 10l-4.5 1.5L12 16l-1.5-4.5L6 10l4.5-1.5z"/></>,
    menu:   <><path d="M4 7h16M4 12h16M4 17h16"/></>,
    flag:   <><path d="M5 21V4M5 4h12l-2 4 2 4H5"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
         strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style}>
      {paths[name] || null}
    </svg>
  );
};

// ─────────────────────────────────────────────
// 위험도 배지 (솔리드 스타일 — 사용자 선택)
// ─────────────────────────────────────────────
const RiskBadge = ({ level, size = "md", showEn = true }) => {
  const r = T.risk[level];
  if (!r) return null;
  const isSm = size === "sm";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: isSm ? "3px 8px" : "5px 11px",
      background: r.solid, color: "white",
      borderRadius: T.radius.sm,
      fontSize: isSm ? 11 : 12, fontWeight: 700, letterSpacing: 0.2,
      lineHeight: 1, whiteSpace: "nowrap",
    }}>
      <span style={{
        width: isSm ? 4 : 5, height: isSm ? 4 : 5, borderRadius: 999,
        background: "rgba(255,255,255,.95)", display: "inline-block"
      }}/>
      {r.label}
      {showEn && <span style={{ opacity: .75, fontWeight: 600, fontSize: isSm ? 9.5 : 10.5 }}>{r.en}</span>}
    </span>
  );
};

// 위험도 소프트 배지
const RiskChip = ({ level, count, active, onClick }) => {
  const r = T.risk[level];
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "8px 12px",
      background: active ? r.soft : "transparent",
      color: active ? r.text : "#374151",
      border: `1px solid ${active ? r.border : "#E5E7EB"}`,
      borderRadius: T.radius.md,
      fontSize: 13, fontWeight: 600, cursor: "pointer",
      transition: "all .15s",
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: r.solid }}/>
      {r.label}
      {typeof count === "number" && (
        <span style={{
          background: active ? "white" : "#F3F4F6",
          color: active ? r.text : "#6B7280",
          padding: "2px 7px", borderRadius: 999, fontSize: 11, fontWeight: 700,
          border: `1px solid ${active ? r.border : "transparent"}`
        }}>{count}</span>
      )}
    </button>
  );
};

// ─────────────────────────────────────────────
// 버튼
// ─────────────────────────────────────────────
const Button = ({ variant = "primary", size = "md", icon, iconRight, children, onClick, fullWidth, palette, disabled, style }) => {
  const p = palette || T.palettes.civic;
  const sizes = {
    sm: { padX: 12, padY: 7, fs: 13, gap: 6 },
    md: { padX: 16, padY: 10, fs: 14, gap: 8 },
    lg: { padX: 22, padY: 13, fs: 16, gap: 10 },
  }[size];
  const variants = {
    primary: { bg: p.brand, fg: "white", bd: p.brand, hover: p.brandStrong },
    secondary: { bg: "white", fg: p.text, bd: p.border, hover: p.surfaceMuted },
    ghost: { bg: "transparent", fg: p.textMuted, bd: "transparent", hover: p.surfaceMuted },
    danger: { bg: T.risk.critical.solid, fg: "white", bd: T.risk.critical.solid, hover: "#B91C1C" },
  };
  const v = variants[variant];
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: sizes.gap,
      padding: `${sizes.padY}px ${sizes.padX}px`,
      background: v.bg, color: v.fg, border: `1px solid ${v.bd}`,
      borderRadius: T.radius.md, fontSize: sizes.fs, fontWeight: 600,
      fontFamily: T.type.family, cursor: disabled ? "not-allowed" : "pointer",
      width: fullWidth ? "100%" : "auto",
      opacity: disabled ? 0.5 : 1,
      transition: "all .15s",
      whiteSpace: "nowrap",
      ...style,
    }}
    onMouseEnter={(e) => !disabled && (e.currentTarget.style.background = v.hover)}
    onMouseLeave={(e) => !disabled && (e.currentTarget.style.background = v.bg)}
    >
      {icon && <Icon name={icon} size={sizes.fs + 2}/>}
      {children}
      {iconRight && <Icon name={iconRight} size={sizes.fs + 2}/>}
    </button>
  );
};

// ─────────────────────────────────────────────
// 툴팁(용어 설명)
// ─────────────────────────────────────────────
const Term = ({ children, def }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 2,
      borderBottom: "1.5px dotted #94A3B8", cursor: "help" }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 13, height: 13, borderRadius: 999, background: "#CBD5E1", color: "white",
        fontSize: 9, fontWeight: 700, marginLeft: 1 }}>i</span>
      {open && (
        <span style={{
          position: "absolute", top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
          background: "#0F1B2D", color: "white", padding: "10px 12px", borderRadius: 8,
          fontSize: 12, fontWeight: 400, lineHeight: 1.5, width: 260,
          boxShadow: T.shadow.lg, zIndex: 100,
          whiteSpace: "normal",
        }}>{def}</span>
      )}
    </span>
  );
};

// ─────────────────────────────────────────────
// 카드 컨테이너
// ─────────────────────────────────────────────
const Card = ({ children, palette, padding = 24, style, onClick }) => {
  const p = palette || T.palettes.civic;
  return (
    <div onClick={onClick} style={{
      background: p.surface, border: `1px solid ${p.border}`,
      borderRadius: T.radius.lg, padding,
      boxShadow: T.shadow.sm, cursor: onClick ? "pointer" : "default",
      ...style,
    }}>{children}</div>
  );
};

// ─────────────────────────────────────────────
// 인용 블록 (사업장 본문)
// ─────────────────────────────────────────────
const Quote = ({ children, label = "사업장 취업규칙 본문", lineNo, highlight, palette }) => {
  const p = palette || T.palettes.civic;
  return (
    <div style={{
      background: "#FAF8F2", border: `1px solid #E8DFC9`,
      borderLeft: `4px solid #B08A2E`,
      borderRadius: 8, padding: "14px 16px",
      fontFamily: T.type.mono, fontSize: 13.5, lineHeight: 1.65,
      color: "#3F3416",
      position: "relative",
    }}>
      <div style={{
        fontFamily: T.type.family, fontSize: 11, fontWeight: 700,
        color: "#86701F", textTransform: "uppercase", letterSpacing: 0.5,
        display: "flex", justifyContent: "space-between", marginBottom: 8,
      }}>
        <span>📌 {label}</span>
        {lineNo && <span style={{ opacity: .7 }}>제{lineNo}</span>}
      </div>
      <div style={{ whiteSpace: "pre-wrap" }}>{children}</div>
    </div>
  );
};

// ─────────────────────────────────────────────
// 진행 바 (위험도 분포)
// ─────────────────────────────────────────────
const RiskDistributionBar = ({ counts, height = 14 }) => {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const order = ["critical", "high", "medium", "low", "ambiguous", "ok"];
  return (
    <div style={{ display: "flex", height, borderRadius: 999, overflow: "hidden",
      border: "1px solid #E5E7EB", background: "#F3F4F6" }}>
      {order.map(k => counts[k] > 0 && (
        <div key={k} style={{
          width: `${(counts[k] / total) * 100}%`,
          background: T.risk[k].solid,
          transition: "width .4s",
        }} title={`${T.risk[k].label}: ${counts[k]}`}/>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────
// 도넛 차트 (간단 SVG)
// ─────────────────────────────────────────────
const Donut = ({ counts, size = 160, thickness = 18 }) => {
  const order = ["critical", "high", "medium", "low", "ambiguous", "ok"];
  const total = order.reduce((a, k) => a + (counts[k] || 0), 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#F3F4F6" strokeWidth={thickness}/>
      {order.map(k => {
        const v = counts[k] || 0;
        if (v === 0) return null;
        const len = (v / total) * c;
        const seg = (
          <circle key={k} cx={size/2} cy={size/2} r={r} fill="none"
            stroke={T.risk[k].solid} strokeWidth={thickness}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}/>
        );
        offset += len;
        return seg;
      })}
    </svg>
  );
};

window.AICOMP = { Icon, RiskBadge, RiskChip, Button, Term, Card, Quote, RiskDistributionBar, Donut };
