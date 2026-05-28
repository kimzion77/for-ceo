/* 화면 1: 홈 — 문서 종류 선택 + 업로드 */

const { Icon, RiskBadge, Button, Card, Term } = window.AICOMP;
const T1 = window.TOKENS;

const DOC_TYPES = [
{
  id: "work-rules",
  icon: "doc",
  title: "취업규칙",
  subtitle: "사업장 단위 근로조건 규정",
  desc: "10인 이상 사업장이 작성·신고해야 하는 취업규칙을 검토합니다.",
  detail: "98조 · 99 검사항목",
  available: true,
  tag: "정식 운영"
},
{
  id: "employment-contract",
  icon: "contract",
  title: "근로계약서",
  subtitle: "개별 근로자 계약서",
  desc: "근로자와 체결한 근로계약서의 필수 기재사항·법정 기준을 검토합니다.",
  detail: "준비 중",
  available: false,
  tag: "출시 예정"
},
{
  id: "wage-statement",
  icon: "receipt",
  title: "임금명세서",
  subtitle: "월별 급여 명세서",
  desc: "임금명세서 교부 의무에 따른 필수 기재사항을 검토합니다.",
  detail: "준비 중",
  available: false,
  tag: "출시 예정"
}];


const HomeScreen = ({ palette, onStart }) => {
  const p = palette || T1.palettes.civic;
  const [selected, setSelected] = React.useState("work-rules");
  const [file, setFile] = React.useState(null);
  const [shiftWork, setShiftWork] = React.useState("unknown");
  const [chemicals, setChemicals] = React.useState("unknown");
  const [envMonitor, setEnvMonitor] = React.useState("unknown");
  const [osh, setOsh] = React.useState(true);

  return (
    <div style={{
      background: p.bg, minHeight: "100%", fontFamily: T1.type.family, color: p.text,
      paddingBottom: 60
    }}>
      {/* 헤더 */}
      <header style={{
        background: p.surface, borderBottom: `1px solid ${p.border}`,
        padding: "14px 32px", display: "flex", alignItems: "center", justifyContent: "space-between"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: p.brand,
            display: "grid", placeItems: "center", color: "white"
          }}>
            <Icon name="shield" size={18} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.2 }}>노동법 자율점검</div>
            <div style={{ fontSize: 11, color: p.textSubtle, marginTop: 1 }}>고용노동부 DB 기반</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 13, color: p.textMuted }}>
          <a style={{ color: "inherit", textDecoration: "none" }}>용어사전</a>
          <a style={{ color: "inherit", textDecoration: "none" }}>FAQ</a>
          <a style={{ color: "inherit", textDecoration: "none" }}>이용안내</a>
          <span style={{ color: p.textSubtle, fontSize: 12, padding: "4px 10px",
            border: `1px solid ${p.border}`, borderRadius: 999 }}>익명 사용 중</span>
        </div>
      </header>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "40px 32px 0" }}>
        {/* Hero */}
        <div style={{ marginBottom: 36 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "5px 12px", background: p.brandSoft, color: p.brand,
            borderRadius: 999, fontSize: 12, fontWeight: 600, marginBottom: 14
          }}>
            <Icon name="sparkle" size={13} /> 무료 · 회원가입 없이 바로 검토
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.8, margin: 0, lineHeight: 1.25 }}>
            우리 사업장의 노동법 서류,<br />
            <span style={{ color: p.brand }}>5분 안에 자율 점검</span>해 보세요.
          </h1>
          <p style={{ fontSize: 15, color: p.textMuted, marginTop: 12, lineHeight: 1.6, maxWidth: 640 }}>
            서류를 올리면 위반·누락 항목을 위험도별로 정리하고, <br />
            <strong style={{ color: p.text }}>어떻게 시정하면 되는지</strong> 법령 근거와 함께 안내합니다.
          </p>
        </div>

        {/* 문서 종류 선택 */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <span style={{
              width: 22, height: 22, borderRadius: 999, background: p.brand,
              color: "white", fontSize: 12, fontWeight: 700, display: "grid", placeItems: "center"
            }}>1</span>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>어떤 문서를 검토하시나요?</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {DOC_TYPES.map((d) => {
              const isSel = selected === d.id;
              const dis = !d.available;
              return (
                <button key={d.id} onClick={() => d.available && setSelected(d.id)} disabled={dis}
                style={{
                  textAlign: "left", padding: 18,
                  background: isSel ? p.surface : dis ? p.surfaceMuted : p.surface,
                  border: `${isSel ? 2 : 1}px solid ${isSel ? p.brand : p.border}`,
                  borderRadius: T1.radius.lg,
                  cursor: dis ? "not-allowed" : "pointer",
                  opacity: dis ? 0.65 : 1,
                  fontFamily: "inherit",
                  transition: "all .15s",
                  position: "relative",
                  boxShadow: isSel ? `0 0 0 4px ${p.brandSoft}` : "none"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: isSel ? p.brand : p.surfaceMuted,
                      color: isSel ? "white" : p.textMuted,
                      display: "grid", placeItems: "center"
                    }}>
                      <Icon name={d.icon} size={20} />
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "3px 7px", borderRadius: 4,
                      background: d.available ? "#D1FAE5" : "#FEF3C7",
                      color: d.available ? "#065F46" : "#92400E", letterSpacing: 0.3
                    }}>{d.tag}</span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: p.text, marginBottom: 4 }}>{d.title}</div>
                  <div style={{ fontSize: 12, color: p.textSubtle, marginBottom: 8 }}>{d.subtitle}</div>
                  <div style={{ fontSize: 13, color: p.textMuted, lineHeight: 1.5, marginBottom: 12 }}>{d.desc}</div>
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 11, color: isSel ? p.brand : p.textSubtle, fontWeight: 600
                  }}>
                    <Icon name="book" size={12} /> {d.detail}
                  </div>
                </button>);

            })}
          </div>
        </div>

        {/* 업로드 */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <span style={{
              width: 22, height: 22, borderRadius: 999, background: p.brand,
              color: "white", fontSize: 12, fontWeight: 700, display: "grid", placeItems: "center"
            }}>2</span>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>취업규칙 파일을 올려주세요</h2>
            <span style={{ fontSize: 12, color: p.textSubtle, marginLeft: "auto" }}>
              <Icon name="shield" size={11} style={{ verticalAlign: -2 }} /> 파일은 검토 후 즉시 삭제됩니다
            </span>
          </div>
          <div onClick={() => setFile(file ? null : { name: "2.비스코스 취업규칙.docx", size: "84.4KB" })} style={{
            background: file ? p.surface : p.surfaceMuted,
            border: `2px dashed ${file ? p.brand : p.borderStrong}`,
            borderRadius: T1.radius.lg, padding: file ? 16 : 36,
            cursor: "pointer", transition: "all .15s",
            textAlign: "center"
          }}>
            {!file ?
            <>
                <Icon name="upload" size={32} color={p.textMuted} />
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 12, color: p.text }}>
                  여기로 파일을 끌어다 놓거나 <span style={{ color: p.brand, textDecoration: "underline" }}>찾아보기</span>
                </div>
                <div style={{ fontSize: 12, color: p.textSubtle, marginTop: 6 }}>
                  DOCX · HWP · HWPX · PDF · TXT · 최대 200MB
                </div>
              </> :

            <div style={{ display: "flex", alignItems: "center", gap: 14, textAlign: "left" }}>
                <div style={{
                width: 40, height: 40, borderRadius: 8, background: p.brandSoft,
                color: p.brand, display: "grid", placeItems: "center"
              }}>
                  <Icon name="file" size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{file.name}</div>
                  <div style={{ fontSize: 12, color: p.textSubtle }}>{file.size} · 업로드 완료</div>
                </div>
                <Icon name="check" size={20} color="#059669" />
              </div>
            }
          </div>
        </div>

        {/* 사업장 정보 */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <span style={{
              width: 22, height: 22, borderRadius: 999, background: p.brand,
              color: "white", fontSize: 12, fontWeight: 700, display: "grid", placeItems: "center"
            }}>3</span>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>사업장 기본 정보</h2>
            <span style={{ fontSize: 12, color: p.textSubtle, marginLeft: 8 }}>
              모르시면 비워두셔도 됩니다 — 보수적으로 검사합니다
            </span>
          </div>
          <Card palette={p} padding={20} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <RadioGroup palette={p} label="교대근로 도입" tip="2조 2교대, 3조 3교대 등 교대제로 근무하는지 여부"
            value={shiftWork} onChange={setShiftWork}
            options={[{ v: "unknown", l: "모름(검사함)" }, { v: "yes", l: "도입함" }, { v: "no", l: "미도입" }]} />
            <RadioGroup palette={p} label="화학물질 취급" tip="유해·위험화학물질을 취급하는지 여부"
            value={chemicals} onChange={setChemicals}
            options={[{ v: "unknown", l: "모름(검사함)" }, { v: "yes", l: "취급함" }, { v: "no", l: "미취급" }]} />
            <RadioGroup palette={p} label="작업환경측정 대상" tip="6개월마다 작업환경측정을 해야 하는 사업장인지"
            value={envMonitor} onChange={setEnvMonitor}
            options={[{ v: "unknown", l: "모름(검사함)" }, { v: "yes", l: "대상" }, { v: "no", l: "비대상" }]} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
                산업안전보건법 적용 업종 <Icon name="info" size={12} color={p.textSubtle} />
              </div>
              <label style={{
                display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
                border: `1px solid ${osh ? p.brand : p.border}`, borderRadius: 8,
                background: osh ? p.brandSoft : "white", cursor: "pointer", fontSize: 13.5
              }}>
                <input type="checkbox" checked={osh} onChange={(e) => setOsh(e.target.checked)}
                style={{ accentColor: p.brand }} />
                해당 업종에 속함
              </label>
            </div>
          </Card>
        </div>

        {/* CTA */}
        <Button variant="primary" size="lg" palette={p} fullWidth icon="search"
        disabled={!file} onClick={onStart}
        style={{ fontSize: 16, padding: "16px 24px" }}>
          검토 시작하기
        </Button>
        <div style={{ textAlign: "center", marginTop: 12, fontSize: 12, color: p.textSubtle }}>
          평균 1~2분 소요됩니다 · 결과는 PDF로 저장하여 사업장 보관 가능
        </div>
      </div>
    </div>);

};

const RadioGroup = ({ label, tip, value, onChange, options, palette }) => {
  const p = palette;
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
        {label} <span title={tip}><Icon name="info" size={12} color={p.textSubtle} /></span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map((opt) =>
        <label key={opt.v} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "8px 12px", borderRadius: 8, fontSize: 13,
          border: `1px solid ${value === opt.v ? p.brand : p.border}`,
          background: value === opt.v ? p.brandSoft : "white",
          color: value === opt.v ? p.brand : p.text,
          fontWeight: value === opt.v ? 600 : 400,
          cursor: "pointer"
        }}>
            <input type="radio" checked={value === opt.v} onChange={() => onChange(opt.v)}
          style={{ accentColor: p.brand }} />
            {opt.l}
          </label>
        )}
      </div>
    </div>);

};

window.HomeScreen = HomeScreen;