/* 화면 3: 결과 종합 대시보드 */

const { Icon: IconR, RiskBadge: RiskBadgeR, RiskChip: RiskChipR, Button: ButtonR, Card: CardR, Donut: DonutR, RiskDistributionBar: BarR } = window.AICOMP;
const TR = window.TOKENS;

const ResultScreen = ({ palette, onOpenFinding, layout = "sidebar" }) => {
  const p = palette || TR.palettes.civic;
  const summary = window.SAMPLE.summary;
  const findings = window.SAMPLE.findings;
  const [filter, setFilter] = React.useState("all");

  const filtered = filter === "all" ? findings : findings.filter(f => f.risk === filter);

  return (
    <div style={{
      background: p.bg, minHeight: "100%", fontFamily: TR.type.family, color: p.text,
    }}>
      {/* 상단 결과 헤더 */}
      <div style={{
        background: p.surface, borderBottom: `1px solid ${p.border}`,
        padding: "20px 32px",
      }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", display: "flex", alignItems: "center", gap: 24 }}>
          <button style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
            border: `1px solid ${p.border}`, background: "white", borderRadius: 8,
            fontSize: 12, color: p.textMuted, fontFamily: "inherit", cursor: "pointer",
          }}>
            <IconR name="arrow" size={14} style={{ transform: "rotate(180deg)" }}/> 새 검토
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <IconR name="file" size={18} color={p.textMuted}/>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{summary.fileName}</div>
              <div style={{ fontSize: 11, color: p.textSubtle }}>
                {summary.fileSize} · 검토 {summary.reviewedAt} · 소요 {summary.duration}
              </div>
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <ButtonR variant="secondary" size="sm" palette={p} icon="print">인쇄</ButtonR>
            <ButtonR variant="secondary" size="sm" palette={p} icon="share">공유 링크</ButtonR>
            <ButtonR variant="primary" size="sm" palette={p} icon="download">PDF 다운로드</ButtonR>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 32px 60px",
        display: "grid", gridTemplateColumns: layout === "sidebar" ? "320px 1fr" : "1fr", gap: 24 }}>

        {/* 좌측: 종합 판정 + 필터 */}
        {layout === "sidebar" && (
          <aside style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 20, alignSelf: "start" }}>
            <VerdictCard palette={p} summary={summary}/>

            <CardR palette={p} padding={18}>
              <div style={{ fontSize: 12, fontWeight: 700, color: p.textMuted, letterSpacing: 0.4,
                textTransform: "uppercase", marginBottom: 14 }}>위반 분포</div>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 14, position: "relative" }}>
                <DonutR counts={summary.counts} size={150} thickness={20}/>
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, color: p.text }}>
                      {summary.counts.critical + summary.counts.high + summary.counts.medium + summary.counts.low}
                    </div>
                    <div style={{ fontSize: 10, color: p.textSubtle, marginTop: 2 }}>지적사항</div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {["critical", "high", "medium", "low", "ambiguous", "ok"].map(k => {
                  const r = TR.risk[k];
                  const v = summary.counts[k] || 0;
                  return (
                    <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: r.solid }}/>
                      <span style={{ color: p.text, fontWeight: 600 }}>{r.label}</span>
                      <span style={{ color: p.textSubtle, fontSize: 10 }}>{r.en}</span>
                      <span style={{ marginLeft: "auto", color: p.text, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{v}</span>
                    </div>
                  );
                })}
              </div>
            </CardR>

            <CardR palette={p} padding={18}>
              <div style={{ fontSize: 12, fontWeight: 700, color: p.textMuted, letterSpacing: 0.4,
                textTransform: "uppercase", marginBottom: 12 }}>가장 먼저 시정해야 할 항목</div>
              {summary.topPriority.map((t, i) => (
                <div key={t.id} style={{
                  display: "flex", gap: 10, padding: "10px 0",
                  borderTop: i > 0 ? `1px solid ${p.border}` : "none",
                  cursor: "pointer",
                }} onClick={() => onOpenFinding && onOpenFinding(t.id)}>
                  <div style={{ flexShrink: 0, marginTop: 2 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: TR.risk[t.risk].solid, display: "block" }}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: p.textSubtle, marginBottom: 2 }}>{t.article}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{t.title}</div>
                  </div>
                </div>
              ))}
            </CardR>
          </aside>
        )}

        {/* 우측: 핀딩 리스트 */}
        <main>
          {/* 필터 칩 */}
          <div style={{
            display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18,
            padding: "12px 14px", background: p.surface, border: `1px solid ${p.border}`, borderRadius: TR.radius.lg,
            alignItems: "center",
          }}>
            <span style={{ fontSize: 12, color: p.textMuted, fontWeight: 600, marginRight: 4 }}>위험도:</span>
            <RiskChipR level="critical" count={summary.counts.critical} active={filter === "critical"} onClick={() => setFilter(filter === "critical" ? "all" : "critical")}/>
            <RiskChipR level="high" count={summary.counts.high} active={filter === "high"} onClick={() => setFilter(filter === "high" ? "all" : "high")}/>
            <RiskChipR level="medium" count={summary.counts.medium} active={filter === "medium"} onClick={() => setFilter(filter === "medium" ? "all" : "medium")}/>
            <RiskChipR level="low" count={summary.counts.low} active={filter === "low"} onClick={() => setFilter(filter === "low" ? "all" : "low")}/>
            <RiskChipR level="ambiguous" count={summary.counts.ambiguous} active={filter === "ambiguous"} onClick={() => setFilter(filter === "ambiguous" ? "all" : "ambiguous")}/>
            <div style={{ width: 1, height: 22, background: p.border, margin: "0 4px" }}/>
            <RiskChipR level="ok" count={summary.counts.ok} active={filter === "ok"} onClick={() => setFilter(filter === "ok" ? "all" : "ok")}/>
            <button style={{
              marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 12, padding: "6px 10px", background: "transparent", color: p.textMuted,
              border: `1px solid ${p.border}`, borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
            }}>
              <IconR name="filter" size={12}/> 조항순 정렬
            </button>
          </div>

          {/* 핀딩 카드 리스트 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {filtered.map(f => (
              <FindingCard key={f.id} finding={f} palette={p} onOpen={() => onOpenFinding && onOpenFinding(f.id)}/>
            ))}
          </div>

          {/* 선택조항 격리 */}
          <div style={{ marginTop: 28, padding: 18, background: p.surfaceMuted,
            border: `1px dashed ${p.borderStrong}`, borderRadius: TR.radius.lg }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <IconR name="info" size={16} color={p.textMuted}/>
              <span style={{ fontSize: 14, fontWeight: 700 }}>선택 조항 52건은 별도 영역에 보관됨</span>
            </div>
            <div style={{ fontSize: 12, color: p.textMuted, marginBottom: 10 }}>
              사업장 정보로 검사 대상이 아닌 조항입니다 (예: 교대근로 미도입 → 교대근로 조항 검사 제외).
            </div>
            <button style={{
              fontSize: 12, padding: "6px 12px", background: "white",
              border: `1px solid ${p.border}`, borderRadius: 8, fontWeight: 600,
              color: p.textMuted, cursor: "pointer", fontFamily: "inherit",
            }}>선택 조항 펼쳐보기 →</button>
          </div>
        </main>
      </div>
    </div>
  );
};

// 종합 판정 카드
const VerdictCard = ({ palette, summary }) => {
  const p = palette;
  const isCritical = summary.verdictKey === "critical";
  return (
    <div style={{
      background: isCritical ? "#FEF2F2" : "#FFF7ED",
      border: `1px solid ${isCritical ? "#FCA5A5" : "#FDBA74"}`,
      borderRadius: TR.radius.lg, padding: 20,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <IconR name={isCritical ? "alert" : "warn"} size={18} color={isCritical ? "#DC2626" : "#EA580C"}/>
        <span style={{ fontSize: 12, fontWeight: 700, color: isCritical ? "#991B1B" : "#9A3412",
          letterSpacing: 0.3, textTransform: "uppercase" }}>종합 판정</span>
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: isCritical ? "#991B1B" : "#9A3412",
        lineHeight: 1.2, marginBottom: 8 }}>
        {summary.verdict}
      </div>
      <div style={{ fontSize: 13, color: "#52606D", lineHeight: 1.55 }}>
        법정 기준에 미달하는 항목이 <strong>{summary.counts.critical}건(심각)</strong> 발견되었습니다.
        먼저 시정해 주세요.
      </div>
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(0,0,0,.08)",
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Stat n={summary.totalSlots} l="총 검사항목"/>
        <Stat n={summary.counts.ok} l="적정 항목" color="#059669"/>
      </div>
    </div>
  );
};

const Stat = ({ n, l, color }) => (
  <div>
    <div style={{ fontSize: 22, fontWeight: 800, color: color || "#0F1B2D", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{n}</div>
    <div style={{ fontSize: 11, color: "#7B8794", marginTop: 4 }}>{l}</div>
  </div>
);

// ─────── 핀딩 카드 (Variant A — 가로 분할) ───────
const FindingCard = ({ finding, palette, onOpen, variant = "split" }) => {
  const p = palette;
  const r = TR.risk[finding.risk];

  if (variant === "stacked") return <FindingCardStacked finding={finding} palette={palette} onOpen={onOpen}/>;
  if (variant === "compact") return <FindingCardCompact finding={finding} palette={palette} onOpen={onOpen}/>;

  return (
    <div style={{
      background: p.surface, border: `1px solid ${p.border}`,
      borderRadius: TR.radius.lg, overflow: "hidden",
      borderLeft: `4px solid ${r.solid}`,
    }}>
      {/* 헤더 */}
      <div style={{ padding: "16px 20px 12px", display: "flex", alignItems: "center", gap: 10 }}>
        <RiskBadgeR level={finding.risk}/>
        <span style={{ fontSize: 12, color: p.textSubtle, fontFamily: TR.type.mono }}>{finding.id}</span>
        <span style={{ fontSize: 12, color: p.textSubtle }}>· {finding.article} {finding.articleTitle}</span>
        <button onClick={onOpen} style={{
          marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4,
          padding: "5px 10px", border: `1px solid ${p.border}`, borderRadius: 6,
          fontSize: 12, color: p.textMuted, background: "white", cursor: "pointer", fontFamily: "inherit",
          fontWeight: 600,
        }}>
          상세 <IconR name="chevron" size={12}/>
        </button>
      </div>

      {/* 제목 */}
      <div style={{ padding: "0 20px 14px" }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, lineHeight: 1.4, color: p.text, letterSpacing: -0.2 }}>
          {finding.title}
        </h3>
      </div>

      {/* 사유 + 인용 + 시정안 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0,
        borderTop: `1px solid ${p.border}` }}>
        <div style={{ padding: "16px 20px", borderRight: `1px solid ${p.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <IconR name="info" size={14} color={r.solid}/>
            <span style={{ fontSize: 11, fontWeight: 700, color: p.textMuted, letterSpacing: 0.4, textTransform: "uppercase" }}>
              왜 이게 문제인가요?
            </span>
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.65, color: p.text }}>{finding.reason}</div>

          <div style={{ marginTop: 14, padding: "10px 12px", background: p.surfaceMuted,
            borderRadius: 8, display: "flex", gap: 12, fontSize: 12 }}>
            <div>
              <div style={{ color: p.textSubtle, marginBottom: 3 }}>현재</div>
              <div style={{ fontWeight: 700, color: r.solid }}>{finding.extracted}</div>
            </div>
            <div style={{ width: 1, background: p.border }}/>
            <div>
              <div style={{ color: p.textSubtle, marginBottom: 3 }}>법정 기준</div>
              <div style={{ fontWeight: 700, color: "#059669" }}>{finding.standard}</div>
            </div>
          </div>
        </div>

        <div style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <IconR name="quote" size={14} color={p.textMuted}/>
            <span style={{ fontSize: 11, fontWeight: 700, color: p.textMuted, letterSpacing: 0.4, textTransform: "uppercase" }}>
              사업장 본문 인용
            </span>
          </div>
          <div style={{
            background: "#FAF8F2", border: `1px solid #E8DFC9`, borderLeft: `3px solid #B08A2E`,
            borderRadius: 6, padding: "10px 12px", fontSize: 13, lineHeight: 1.55,
            color: "#3F3416", fontFamily: TR.type.mono,
          }}>
            {finding.quote}
          </div>
        </div>
      </div>

      {/* 시정 가이드 (강조) */}
      <div style={{ padding: "14px 20px 18px", background: "linear-gradient(180deg, #F0FDF4 0%, white 100%)",
        borderTop: `1px solid ${p.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 18, height: 18, borderRadius: 999, background: "#059669", color: "white" }}>
            <IconR name="check" size={11} strokeWidth={2.5}/>
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#065F46", letterSpacing: 0.4, textTransform: "uppercase" }}>
            이렇게 고쳐 보세요
          </span>
        </div>
        <div style={{
          background: "white", border: `1px solid #6EE7B7`,
          borderRadius: 8, padding: "12px 14px", fontSize: 13, lineHeight: 1.6,
          color: "#064E3B", fontFamily: TR.type.mono,
        }}>
          {finding.suggested}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {finding.laws.map(law => (
              <span key={law.name} style={{
                fontSize: 11, padding: "3px 8px", background: p.brandSoft,
                color: p.brand, borderRadius: 4, fontWeight: 600,
              }}>⚖ {law.name}</span>
            ))}
          </div>
          <button style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontSize: 12, fontWeight: 600, color: "#065F46",
            padding: "5px 10px", border: "1px solid #6EE7B7", borderRadius: 6,
            background: "white", cursor: "pointer", fontFamily: "inherit",
          }}>
            <IconR name="edit" size={12}/> 복사하기
          </button>
        </div>
      </div>
    </div>
  );
};

// Variant B — 세로 적층 (모바일/태블릿 우선)
const FindingCardStacked = ({ finding, palette, onOpen }) => {
  const p = palette;
  const r = TR.risk[finding.risk];
  return (
    <div style={{
      background: p.surface, border: `1px solid ${p.border}`,
      borderRadius: TR.radius.lg, overflow: "hidden",
    }}>
      <div style={{ padding: "14px 18px", background: r.soft, display: "flex", alignItems: "center", gap: 10 }}>
        <RiskBadgeR level={finding.risk}/>
        <div style={{ fontSize: 14, fontWeight: 700, color: r.text, flex: 1 }}>{finding.title}</div>
      </div>
      <div style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 11, color: p.textSubtle, marginBottom: 4 }}>{finding.id} · {finding.article}</div>
        <div style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: 14 }}>{finding.reason}</div>
        <div style={{ background: "#FAF8F2", border: "1px solid #E8DFC9", borderLeft: "3px solid #B08A2E",
          borderRadius: 6, padding: "10px 12px", fontSize: 12.5, fontFamily: TR.type.mono,
          color: "#3F3416", marginBottom: 10 }}>
          {finding.quote}
        </div>
        <div style={{ background: "white", border: "1px solid #6EE7B7", borderLeft: "3px solid #059669",
          borderRadius: 6, padding: "10px 12px", fontSize: 12.5, fontFamily: TR.type.mono,
          color: "#064E3B" }}>
          ✓ {finding.suggested}
        </div>
      </div>
    </div>
  );
};

// Variant C — 컴팩트 (리스트형)
const FindingCardCompact = ({ finding, palette, onOpen }) => {
  const p = palette;
  const r = TR.risk[finding.risk];
  return (
    <div onClick={onOpen} style={{
      background: p.surface, border: `1px solid ${p.border}`,
      borderRadius: TR.radius.md, padding: "12px 16px",
      display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
    }}>
      <span style={{ width: 4, alignSelf: "stretch", background: r.solid, borderRadius: 2 }}/>
      <RiskBadgeR level={finding.risk} size="sm" showEn={false}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{finding.title}</div>
        <div style={{ fontSize: 12, color: p.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {finding.article} {finding.articleTitle} · {finding.reason.slice(0, 60)}…
        </div>
      </div>
      <IconR name="chevron" size={16} color={p.textSubtle}/>
    </div>
  );
};

window.ResultScreen = ResultScreen;
window.FindingCard = FindingCard;
