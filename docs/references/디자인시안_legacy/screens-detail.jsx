/* 화면 4: 핀딩 상세 (드릴다운) + 시정 가이드 풀버전 */

const { Icon: IconD, RiskBadge: RiskBadgeD, Button: ButtonD, Card: CardD, Term: TermD } = window.AICOMP;
const TD = window.TOKENS;

const FindingDetailScreen = ({ palette, findingId, onBack }) => {
  const p = palette || TD.palettes.civic;
  const f = window.SAMPLE.findings.find(x => x.id === findingId) || window.SAMPLE.findings[0];
  const r = TD.risk[f.risk];
  const [tab, setTab] = React.useState("guide");
  const [copied, setCopied] = React.useState(false);

  return (
    <div style={{ background: p.bg, minHeight: "100%", fontFamily: TD.type.family, color: p.text }}>
      {/* Breadcrumb */}
      <div style={{ background: p.surface, borderBottom: `1px solid ${p.border}`, padding: "12px 32px" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: p.textMuted }}>
          <button onClick={onBack} style={{
            background: "transparent", border: "none", color: p.textMuted, cursor: "pointer",
            fontFamily: "inherit", fontSize: 12, display: "flex", alignItems: "center", gap: 4,
          }}>
            <IconD name="arrow" size={12} style={{ transform: "rotate(180deg)" }}/> 결과 페이지
          </button>
          <span>›</span>
          <span>{f.article} {f.articleTitle}</span>
          <span>›</span>
          <span style={{ color: p.text, fontWeight: 600 }}>{f.id}</span>
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 32px 60px" }}>
        {/* 핀딩 헤더 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <RiskBadgeD level={f.risk}/>
          <span style={{ fontSize: 12, color: p.textSubtle, fontFamily: TD.type.mono }}>{f.id}</span>
          <span style={{ fontSize: 12, color: p.textSubtle }}>· {f.article} {f.articleTitle}</span>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.6, margin: "0 0 12px",
          lineHeight: 1.3 }}>{f.title}</h1>
        <p style={{ fontSize: 15, color: p.textMuted, margin: 0, lineHeight: 1.6, maxWidth: 720 }}>
          {f.reason}
        </p>

        {/* 비교 박스 */}
        <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "stretch" }}>
          <CompareBox label="현재 사업장 규정" value={f.extracted} tone="bad"/>
          <div style={{ display: "grid", placeItems: "center", color: p.textSubtle }}>
            <IconD name="arrow" size={20}/>
          </div>
          <CompareBox label="법정 기준" value={f.standard} tone="good"/>
        </div>

        {/* 탭 */}
        <div style={{ marginTop: 28, borderBottom: `1px solid ${p.border}`, display: "flex", gap: 4 }}>
          {[
            { k: "guide", l: "시정 가이드", icon: "edit" },
            { k: "law", l: "근거 법령", icon: "scale" },
            { k: "context", l: "본문 위치", icon: "quote" },
            { k: "topic", l: "연관 주제", icon: "book" },
            { k: "debug", l: "기술 정보", icon: "info" },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{
              padding: "10px 16px", border: "none", background: "transparent",
              borderBottom: `2px solid ${tab === t.k ? p.brand : "transparent"}`,
              color: tab === t.k ? p.brand : p.textMuted,
              fontWeight: tab === t.k ? 700 : 500, fontSize: 13.5, fontFamily: "inherit",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
              marginBottom: -1,
            }}>
              <IconD name={t.icon} size={14}/>
              {t.l}
            </button>
          ))}
        </div>

        {/* 탭 콘텐츠 */}
        <div style={{ paddingTop: 24 }}>
          {tab === "guide" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <CardD palette={p} padding={20}>
                <Heading icon="quote" tone={p.textMuted}>현재 본문 (수정 전)</Heading>
                <div style={{
                  marginTop: 12, padding: 14, background: "#FEF2F2", border: "1px solid #FECACA",
                  borderLeft: "3px solid #DC2626", borderRadius: 8, fontSize: 13.5, lineHeight: 1.7,
                  fontFamily: TD.type.mono, color: "#7F1D1D",
                }}>{f.quote}</div>
                <div style={{ fontSize: 11, color: p.textSubtle, marginTop: 10 }}>
                  <strong style={{ color: "#DC2626" }}>붉은색</strong> 표시 부분이 법정 기준에 미달합니다.
                </div>
              </CardD>
              <CardD palette={p} padding={20} style={{ border: "1px solid #6EE7B7", background: "linear-gradient(180deg, #F0FDF4 0%, white 80%)" }}>
                <Heading icon="check" tone="#059669">시정안 (이렇게 고쳐보세요)</Heading>
                <div style={{
                  marginTop: 12, padding: 14, background: "white", border: "1px solid #6EE7B7",
                  borderLeft: "3px solid #059669", borderRadius: 8, fontSize: 13.5, lineHeight: 1.7,
                  fontFamily: TD.type.mono, color: "#064E3B",
                }}>{f.suggested}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                    style={{
                    flex: 1, padding: "9px 12px", background: "#059669", color: "white",
                    border: "none", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer",
                    fontFamily: "inherit", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                  }}>
                    <IconD name={copied ? "check" : "edit"} size={14}/>
                    {copied ? "복사됨" : "시정안 복사"}
                  </button>
                  <button style={{
                    padding: "9px 12px", background: "white", color: "#065F46",
                    border: "1px solid #6EE7B7", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer",
                    fontFamily: "inherit",
                  }}>해결됨 표시</button>
                </div>
              </CardD>

              <div style={{ gridColumn: "1 / -1", padding: 16, background: p.brandSoft,
                border: `1px solid ${p.border}`, borderRadius: 10, display: "flex", gap: 12 }}>
                <IconD name="info" size={20} color={p.brand} style={{ flexShrink: 0, marginTop: 2 }}/>
                <div style={{ fontSize: 13, color: p.text, lineHeight: 1.6 }}>
                  <strong>참고:</strong> 시정안은 표준 문구 예시입니다. 사업장 상황에 맞게 다듬어 사용하세요.
                  취업규칙 변경 시에는 <TermD def="근로자 과반수 또는 근로자대표(노조)의 의견을 듣거나 동의를 받아야 합니다. 불이익 변경의 경우 동의가 필수입니다.">근로자 의견청취</TermD> 절차가 필요합니다.
                </div>
              </div>
            </div>
          )}

          {tab === "law" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {f.laws.map(law => (
                <CardD key={law.name} palette={p} padding={18}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                    <span style={{
                      padding: "3px 8px", background: p.brandSoft, color: p.brand,
                      fontSize: 12, fontWeight: 700, borderRadius: 4,
                    }}>⚖ {law.name}</span>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.7, color: p.text,
                    background: p.surfaceMuted, padding: "12px 14px", borderRadius: 8,
                    fontFamily: TD.type.mono }}>
                    {law.text}
                  </div>
                </CardD>
              ))}
            </div>
          )}

          {tab === "context" && (
            <CardD palette={p} padding={20}>
              <Heading icon="quote" tone={p.textMuted}>사업장 본문에서의 위치</Heading>
              <div style={{ marginTop: 14, fontFamily: TD.type.mono, fontSize: 13, lineHeight: 1.9, color: p.textMuted }}>
                <div style={{ opacity: .5 }}>제22조(휴게시간) 근로자에게 ...</div>
                <div style={{ opacity: .5 }}>제23조(근로시간) 1주 근로시간은 40시간으로 한다.</div>
                <div style={{
                  background: "#FEF3C7", borderLeft: "3px solid #D97706",
                  padding: "10px 12px", margin: "8px 0", color: "#78350F", fontWeight: 600,
                }}>
                  {f.quote}
                  <span style={{ display: "block", fontSize: 11, color: "#92400E", marginTop: 6, fontWeight: 700 }}>
                    ▲ 여기가 문제 부분입니다
                  </span>
                </div>
                <div style={{ opacity: .5 }}>제25조(야간 및 휴일근로) 회사는 ...</div>
                <div style={{ opacity: .5 }}>제26조(보상휴가) 회사는 ...</div>
              </div>
            </CardD>
          )}

          {tab === "topic" && (
            <CardD palette={p} padding={20}>
              <Heading icon="book" tone={p.textMuted}>연관 주제 ({f.topics.length})</Heading>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                {f.topics.map(t => (
                  <span key={t} style={{
                    padding: "6px 12px", background: p.surfaceMuted,
                    border: `1px solid ${p.border}`, borderRadius: 999,
                    fontSize: 12, fontWeight: 600,
                  }}>#{t}</span>
                ))}
              </div>
              <div style={{ marginTop: 16, fontSize: 12, color: p.textSubtle, lineHeight: 1.6 }}>
                같은 주제의 다른 조항도 함께 검토하시면 일관성 있는 규정을 만들 수 있습니다.
              </div>
            </CardD>
          )}

          {tab === "debug" && (
            <CardD palette={p} padding={20} style={{ background: p.surfaceMuted }}>
              <Heading icon="info" tone={p.textMuted}>기술 정보 (전문가용)</Heading>
              <div style={{ marginTop: 14, fontFamily: TD.type.mono, fontSize: 12, lineHeight: 2,
                color: p.textMuted }}>
                <div><span style={{ color: p.textSubtle }}>slot_id:</span> {f.slotId}</div>
                <div><span style={{ color: p.textSubtle }}>extracted:</span> "{f.extracted}"</div>
                <div><span style={{ color: p.textSubtle }}>standard:</span> "{f.standard}"</div>
                <div><span style={{ color: p.textSubtle }}>status:</span> {f.status}</div>
                <div><span style={{ color: p.textSubtle }}>risk_level:</span> {f.risk.toUpperCase()}</div>
                <div><span style={{ color: p.textSubtle }}>master_db_row:</span> {f.article.replace(/[제조]/g, "")} / 14 columns</div>
              </div>
            </CardD>
          )}
        </div>

        {/* 다음 핀딩 네비 */}
        <div style={{ marginTop: 32, padding: 16, background: p.surface,
          border: `1px solid ${p.border}`, borderRadius: 10,
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent",
            border: "none", color: p.textMuted, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
            <IconD name="arrow" size={14} style={{ transform: "rotate(180deg)" }}/>
            <span>이전: S-013 휴게시간 부여</span>
          </button>
          <span style={{ fontSize: 11, color: p.textSubtle }}>지적사항 14 / 18</span>
          <button style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent",
            border: "none", color: p.brand, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600 }}>
            <span>다음: S-027 1년 미만 월차</span>
            <IconD name="arrow" size={14}/>
          </button>
        </div>
      </div>
    </div>
  );
};

const CompareBox = ({ label, value, tone }) => {
  const colors = tone === "bad"
    ? { bg: "#FEF2F2", border: "#FECACA", text: "#991B1B", sub: "#DC2626" }
    : { bg: "#F0FDF4", border: "#86EFAC", text: "#065F46", sub: "#059669" };
  return (
    <div style={{
      background: colors.bg, border: `1px solid ${colors.border}`,
      borderRadius: 10, padding: "14px 16px",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: colors.sub, letterSpacing: 0.5,
        textTransform: "uppercase", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: colors.text, letterSpacing: -0.3 }}>
        {value}
      </div>
    </div>
  );
};

const Heading = ({ icon, tone, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700,
    color: tone, letterSpacing: 0.4, textTransform: "uppercase" }}>
    <IconD name={icon} size={14}/>
    {children}
  </div>
);

window.FindingDetailScreen = FindingDetailScreen;
