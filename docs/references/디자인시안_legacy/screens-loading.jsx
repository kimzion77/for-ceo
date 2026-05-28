/* 화면 2: 검토 진행중 (로딩) */

const { Icon: Icon2 } = window.AICOMP;
const T2 = window.TOKENS;

const LoadingScreen = ({ palette }) => {
  const p = palette || T2.palettes.civic;
  const [step, setStep] = React.useState(2);
  const [pct, setPct] = React.useState(48);

  React.useEffect(() => {
    const id = setInterval(() => {
      setPct(v => v >= 95 ? 48 : v + 1);
      setStep(s => (s % 4) + 1);
    }, 800);
    return () => clearInterval(id);
  }, []);

  const steps = [
    { n: 1, t: "문서 추출", d: "DOCX/HWP 텍스트 파싱" },
    { n: 2, t: "조항 식별", d: "98개 조항 단위로 분류" },
    { n: 3, t: "법령 비교", d: "DOCX/HWP 텍스트 파싱" },
    { n: 4, t: "리포트 생성", d: "위험도·시정 가이드 작성" },
  ];

  return (
    <div style={{
      background: p.bg, minHeight: "100%", fontFamily: T2.type.family,
      display: "grid", placeItems: "center", padding: 40,
    }}>
      <div style={{ maxWidth: 560, width: "100%", textAlign: "center" }}>
        {/* 회전 로더 + 도큐먼트 */}
        <div style={{ position: "relative", width: 100, height: 100, margin: "0 auto 28px" }}>
          <svg width="100" height="100" viewBox="0 0 100 100" style={{ animation: "spin 2s linear infinite" }}>
            <circle cx="50" cy="50" r="42" fill="none" stroke={p.brandSoft} strokeWidth="4"/>
            <circle cx="50" cy="50" r="42" fill="none" stroke={p.brand} strokeWidth="4"
              strokeLinecap="round" strokeDasharray="60 200"/>
          </svg>
          <div style={{
            position: "absolute", inset: 0, display: "grid", placeItems: "center",
            color: p.brand,
          }}>
            <Icon2 name="doc" size={36}/>
          </div>
        </div>

        <div style={{ fontSize: 13, color: p.brand, fontWeight: 700, letterSpacing: 0.5, marginBottom: 8 }}>
          검토 진행중
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5, margin: "0 0 8px" }}>
          취업규칙을 꼼꼼히 살펴보고 있어요
        </h2>
        <div style={{ fontSize: 14, color: p.textMuted, marginBottom: 32 }}>
          평균 1~2분 소요됩니다. 페이지를 닫지 말고 잠시만 기다려 주세요.
        </div>

        {/* 진행 바 */}
        <div style={{ background: p.surface, border: `1px solid ${p.border}`,
          borderRadius: T2.radius.lg, padding: "20px 24px", marginBottom: 16, textAlign: "left" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>전체 진행률</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: p.brand, fontVariantNumeric: "tabular-nums" }}>
              {pct}<span style={{ fontSize: 13, color: p.textSubtle, marginLeft: 2 }}>%</span>
            </span>
          </div>
          <div style={{ height: 8, background: p.surfaceMuted, borderRadius: 999, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${pct}%`, background: p.brand,
              borderRadius: 999, transition: "width .4s",
            }}/>
          </div>
        </div>

        {/* 단계별 */}
        <div style={{ background: p.surface, border: `1px solid ${p.border}`,
          borderRadius: T2.radius.lg, padding: 4, textAlign: "left" }}>
          {steps.map((s, i) => {
            const done = s.n < step;
            const active = s.n === step;
            return (
              <div key={s.n} style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "12px 16px",
                borderBottom: i < 3 ? `1px solid ${p.border}` : "none",
                opacity: !done && !active ? 0.55 : 1,
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 999,
                  background: done ? p.brand : (active ? p.brandSoft : p.surfaceMuted),
                  color: done ? "white" : (active ? p.brand : p.textSubtle),
                  display: "grid", placeItems: "center",
                  fontSize: 12, fontWeight: 700,
                }}>
                  {done ? <Icon2 name="check" size={14}/> : s.n}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: p.text }}>{s.t}</div>
                  <div style={{ fontSize: 12, color: p.textSubtle, marginTop: 1 }}>{s.d}</div>
                </div>
                {active && (
                  <div style={{ display: "flex", gap: 3 }}>
                    {[0,1,2].map(d => (
                      <span key={d} style={{
                        width: 5, height: 5, borderRadius: 999, background: p.brand,
                        animation: `pulse 1.2s ${d * 0.2}s infinite ease-in-out`,
                      }}/>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 24, fontSize: 12, color: p.textSubtle }}>
          💡 검토 중에 알려드릴 팁: 결과 페이지는 PDF로 저장해 사업장에 보관할 수 있어요.
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: .3; transform: scale(1); } 50% { opacity: 1; transform: scale(1.4); } }
      `}}/>
    </div>
  );
};

window.LoadingScreen = LoadingScreen;
