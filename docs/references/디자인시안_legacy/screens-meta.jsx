/* 화면 5: SPA 권고서 (Streamlit vs SPA) + 디자인 시스템 토큰 카드 */

const { Icon: IconS, Card: CardS, Button: ButtonS } = window.AICOMP;
const TS = window.TOKENS;

const RecommendationScreen = ({ palette }) => {
  const p = palette || TS.palettes.civic;
  return (
    <div style={{ background: p.bg, fontFamily: TS.type.family, color: p.text, padding: "32px",
      minHeight: "100%" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: p.brand, letterSpacing: 0.5,
          textTransform: "uppercase", marginBottom: 8 }}>디자인 권고서</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, margin: "0 0 8px" }}>
          Streamlit 유지 vs 별도 SPA — 권장: <span style={{ color: p.brand }}>Next.js SPA 전환</span>
        </h1>
        <p style={{ fontSize: 14, color: p.textMuted, margin: 0, lineHeight: 1.6, maxWidth: 720 }}>
          본 의뢰의 UX 목표(비전공 사업주의 5분 파악, 친근하면서도 신뢰감 있는 톤, PDF 보관용 출력)를
          기준으로 평가했습니다.
        </p>

        {/* 비교 테이블 */}
        <div style={{ marginTop: 28, background: p.surface, border: `1px solid ${p.border}`,
          borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 1fr",
            background: p.surfaceMuted, padding: "12px 18px", fontSize: 12, fontWeight: 700,
            color: p.textMuted, letterSpacing: 0.3, textTransform: "uppercase" }}>
            <div>평가 기준</div>
            <div>Streamlit 유지</div>
            <div style={{ color: p.brand }}>Next.js SPA (권장)</div>
          </div>
          {[
            { k: "정보 구조 자유도", s: { v: "탭/컬럼 등 제한된 컴포넌트만 가능. 핀딩 카드 grid 분할·sticky 사이드바 어려움", t: "bad" }, n: { v: "결과 페이지의 좌측 종합판정·우측 핀딩 리스트 등 자유로운 레이아웃", t: "good" } },
            { k: "톤·시각 일관성", s: { v: "Streamlit 기본 위젯이 노출되어 정부 신뢰감 톤과 충돌", t: "bad" }, n: { v: "Pretendard·디자인 토큰 풀제어 — 정부24 + 친근 톤 모두 가능", t: "good" } },
            { k: "응답성·인터랙션", s: { v: "위젯 변경마다 페이지 재실행. 핀딩 카드 펼침/축소가 어색", t: "warn" }, n: { v: "클라이언트 상태로 즉각 반응. 필터·정렬·드릴다운 매끄러움", t: "good" } },
            { k: "PDF 출력 품질", s: { v: "브라우저 인쇄 의존, 페이지 분리·레이아웃 깨짐 빈번", t: "bad" }, n: { v: "전용 print CSS + react-pdf로 사업장 보관용 고품질 PDF", t: "good" } },
            { k: "확장 (3개 모듈)", s: { v: "단일 페이지 라우팅에 한계. /work-rules /contract /wage 분기 어색", t: "bad" }, n: { v: "Next.js App Router로 /review/[type] 동적 라우트, 코드 공유", t: "good" } },
            { k: "개발 속도(초기)", s: { v: "Python 단일 코드베이스로 빠름", t: "good" }, n: { v: "백엔드 API 분리 + 프론트 별도 — 초기 1~2주 추가 비용", t: "warn" } },
            { k: "운영 비용", s: { v: "Streamlit Cloud 단일 배포", t: "good" }, n: { v: "Vercel(프론트) + 백엔드 API 서버 분리 운영", t: "warn" } },
            { k: "접근성·모바일", s: { v: "사이드바·탭 모바일 동작 한계", t: "warn" }, n: { v: "반응형·키보드 네비·스크린리더 풀제어", t: "good" } },
          ].map((row, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "200px 1fr 1fr",
              padding: "14px 18px", borderTop: `1px solid ${p.border}`, fontSize: 13 }}>
              <div style={{ fontWeight: 700, color: p.text }}>{row.k}</div>
              <CompareCell {...row.s}/>
              <CompareCell {...row.n}/>
            </div>
          ))}
        </div>

        {/* 권고 결론 */}
        <div style={{ marginTop: 28, padding: 20, borderRadius: 14,
          background: p.brandSoft, border: `1px solid ${p.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <IconS name="target" size={18} color={p.brand}/>
            <span style={{ fontSize: 12, fontWeight: 700, color: p.brand, letterSpacing: 0.4,
              textTransform: "uppercase" }}>권장 결정</span>
          </div>
          <div style={{ fontSize: 15.5, lineHeight: 1.7, color: p.text }}>
            <strong>Next.js + React</strong>로 전환하시기를 권장합니다. 백엔드는 FastAPI로 노출
            (검토 엔진은 그대로 유지)하고, 향후 추가될 <strong>근로계약서·임금명세서</strong> 모듈에
            동일한 컴포넌트 라이브러리(<code style={{ background: p.surfaceMuted, padding: "1px 6px",
            borderRadius: 4, fontSize: 12.5 }}>ReviewLayout · FindingCard · RiskBadge · MasterDBTable</code>)를
            재사용하는 구조가 유지보수·UX 양쪽에서 유리합니다.
          </div>

          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <Pill icon="spark" title="초기 1~2주" desc="API 분리 + 디자인 시스템"/>
            <Pill icon="chart" title="중기 4~6주" desc="3개 모듈 통합 라우팅"/>
            <Pill icon="shield" title="장기" desc="공공기관 도입 대비 접근성·보안"/>
          </div>
        </div>

        {/* 컴포넌트 권장 구조 */}
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 36, marginBottom: 12 }}>
          컴포넌트 추상화 권장
        </h2>
        <div style={{ background: p.surface, border: `1px solid ${p.border}`,
          borderRadius: 12, padding: "16px 20px", fontFamily: TS.type.mono, fontSize: 12.5,
          lineHeight: 1.9, color: p.textMuted }}>
          <div style={{ color: "#7C3AED" }}>// 문서 종류에 의존하지 않는 추상 컴포넌트</div>
          <div>&lt;ReviewLayout docType=<span style={{ color: "#059669" }}>"work-rules" | "contract" | "wage"</span>&gt;</div>
          <div>&nbsp;&nbsp;&lt;ReviewSummary verdict counts /&gt;</div>
          <div>&nbsp;&nbsp;&lt;FindingCard finding /&gt; <span style={{ color: "#7C3AED" }}>// 99개 슬롯 평가 단위</span></div>
          <div>&nbsp;&nbsp;&lt;RiskBadge level=<span style={{ color: "#059669" }}>"critical"</span> /&gt; <span style={{ color: "#7C3AED" }}>// 5단계 공통</span></div>
          <div>&nbsp;&nbsp;&lt;LawCitation laws /&gt;</div>
          <div>&nbsp;&nbsp;&lt;FixSuggestion before after /&gt; <span style={{ color: "#7C3AED" }}>// 시정안</span></div>
          <div>&lt;/ReviewLayout&gt;</div>
        </div>
      </div>
    </div>
  );
};

const CompareCell = ({ v, t }) => {
  const colors = {
    good: { c: "#059669", bg: "#F0FDF4", icon: "check" },
    warn: { c: "#D97706", bg: "#FFFBEB", icon: "warn" },
    bad: { c: "#DC2626", bg: "#FEF2F2", icon: "x" },
  }[t];
  return (
    <div style={{ display: "flex", gap: 8, paddingLeft: 8 }}>
      <span style={{ width: 18, height: 18, borderRadius: 999, background: colors.bg,
        color: colors.c, display: "grid", placeItems: "center", flexShrink: 0, marginTop: 2 }}>
        <IconS name={colors.icon} size={11} strokeWidth={2.5}/>
      </span>
      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "#374151" }}>{v}</div>
    </div>
  );
};

const Pill = ({ icon, title, desc }) => (
  <div style={{ background: "white", border: "1px solid rgba(0,0,0,.08)", borderRadius: 10,
    padding: "12px 14px" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
      <IconS name={icon} size={14} color="#0B3D91"/>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
    </div>
    <div style={{ fontSize: 12, color: "#6B7280" }}>{desc}</div>
  </div>
);

// ─────── 디자인 토큰 카드 (시각화) ───────
const TokenCard = ({ palette }) => {
  const p = palette || TS.palettes.civic;
  return (
    <div style={{ background: p.bg, padding: 32, fontFamily: TS.type.family, minHeight: "100%" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: p.brand, letterSpacing: 0.5,
          textTransform: "uppercase", marginBottom: 8 }}>디자인 시스템</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, margin: "0 0 24px" }}>
          토큰 · 컴포넌트 — {p.name}
        </h1>

        {/* 색상 */}
        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 24, marginBottom: 12 }}>색상 팔레트</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
          {[
            ["brand", p.brand], ["brandStrong", p.brandStrong], ["brandSoft", p.brandSoft],
            ["surface", p.surface], ["surfaceMuted", p.surfaceMuted], ["bg", p.bg],
          ].map(([k, c]) => (
            <Swatch key={k} name={k} color={c} text={p.text}/>
          ))}
        </div>

        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 12 }}>위험도 색상</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10 }}>
          {Object.entries(TS.risk).map(([k, r]) => (
            <div key={k} style={{ background: p.surface, border: `1px solid ${p.border}`,
              borderRadius: 10, padding: 12 }}>
              <div style={{ background: r.solid, height: 40, borderRadius: 6, marginBottom: 8 }}/>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{r.label}</div>
              <div style={{ fontSize: 10, color: p.textSubtle, fontFamily: TS.type.mono }}>{r.en}</div>
              <div style={{ fontSize: 10, color: p.textSubtle, fontFamily: TS.type.mono, marginTop: 2 }}>{r.solid}</div>
            </div>
          ))}
        </div>

        {/* 타이포 */}
        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 12 }}>타이포그래피 — Pretendard</h2>
        <div style={{ background: p.surface, border: `1px solid ${p.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.8, lineHeight: 1.25 }}>Display 32 / 800</div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, marginTop: 6 }}>H1 26 / 800</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>H2 20 / 700</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 6 }}>H3 17 / 700</div>
          <div style={{ fontSize: 15, lineHeight: 1.6, marginTop: 10, color: p.textMuted }}>
            본문 15 / 400 · 우리 사업장의 노동법 서류, 5분 안에 자율 점검해 보세요.
          </div>
          <div style={{ fontSize: 13, color: p.textSubtle, marginTop: 6 }}>Small 13 / 보조 정보</div>
          <div style={{ fontSize: 12, color: p.textSubtle, marginTop: 4, fontFamily: TS.type.mono }}>Caption 12 / Mono 인용·코드</div>
        </div>

        {/* 간격 */}
        <h2 style={{ fontSize: 16, fontWeight: 700, marginTop: 28, marginBottom: 12 }}>간격 스케일</h2>
        <div style={{ background: p.surface, border: `1px solid ${p.border}`, borderRadius: 12, padding: 20,
          display: "flex", alignItems: "flex-end", gap: 18 }}>
          {[1,2,3,4,5,6,7,8,9,10].map(k => (
            <div key={k} style={{ textAlign: "center" }}>
              <div style={{ background: p.brand, width: TS.space[k], height: TS.space[k], borderRadius: 2 }}/>
              <div style={{ fontSize: 10, color: p.textSubtle, marginTop: 6, fontFamily: TS.type.mono }}>{k}<br/>{TS.space[k]}px</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Swatch = ({ name, color, text }) => {
  const isLight = ["#FFFFFF", "#F5F7FA", "#F7F4EE", "#FAFAF7", "#EEF2F6", "#F0EBE1", "#F2F0EC", "#E5ECF8", "#E6EEF8", "#EAF1FC"].includes(color);
  return (
    <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid rgba(0,0,0,.08)" }}>
      <div style={{ background: color, height: 64, display: "grid", placeItems: "center" }}>
        {isLight && <span style={{ fontSize: 10, color: "#9CA3AF" }}>↑ light</span>}
      </div>
      <div style={{ background: "white", padding: "8px 10px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: text }}>{name}</div>
        <div style={{ fontSize: 10, color: "#9CA3AF", fontFamily: TS.type.mono, marginTop: 1 }}>{color}</div>
      </div>
    </div>
  );
};

window.RecommendationScreen = RecommendationScreen;
window.TokenCard = TokenCard;
