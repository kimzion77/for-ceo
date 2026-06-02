/**
 * 노무 가이드 API 클라이언트.
 *
 * 백엔드: `backend/cgr/api/routes/guide.py`
 * 자율점검 본질 — 사업주가 자기 점검에 활용할 가이드만 반환 (분쟁·진정 제외).
 */
import { apiGet, apiPostJson } from './client';

export interface GuideItem {
  code: string;
  audience: 'employer' | 'worker' | 'both';
  category: string;
  title: string;
  worker_reason: string;
  employer_reason: string;
  key_points: string;
  related_laws: string;
  priority: string;
  applies_under_5: string;
  note: string;
}

export interface GlossaryEntry {
  code: string;
  term: string;
  short_def: string;
  full_def: string;
  confusable_with: string;
  legal_basis: string;
}

export interface SizeDuty {
  code: string;
  min_size: string;
  duty: string;
  description: string;
  related_docs: string;
  legal_basis: string;
}

export interface ObligationTimeline {
  code: string;
  stage: string;
  duty: string;
  description: string;
  deadline: string;
  legal_basis: string;
  priority: string;
  penalty: string;
}

export interface FormTemplate {
  code: string;
  category: string;
  form_name: string;
  purpose: string;
  submitter: string;
  submit_to: string;
  submit_method: string;
  deadline: string;
  legal_basis: string;
  /** 폴백용 외부 URL — has_local 이 false 면 이쪽으로 redirect */
  download_url: string | null;
  audience: string;
  /** Phase 18 — 우리 서버에 양식 파일이 있으면 true. true 면 `formDownloadUrl(code)` 직접 호출 가능. */
  has_local: boolean;
  local_filename: string | null;
  local_mime: string | null;
  local_size: number | null;
  fetched_at: string | null;
}

/**
 * 양식 파일 다운로드 URL — BFF 경유.
 *
 * - 백엔드가 `local_filename` 으로 실제 파일 보유 시 FileResponse (정확한 MIME)
 * - 없으면 외부 `download_url` 로 302 redirect (사용자가 외부 사이트에서라도 찾을 수 있게)
 */
export const formDownloadUrl = (code: string): string =>
  `/api/cgr/guide/forms/${encodeURIComponent(code)}/download`;

export interface WageCalcFormula {
  code: string;
  category: string;
  calc_name: string;
  formula: string;
  conditions: string;
  limits: string;
  legal_basis: string;
  note: string;
  related_violation_code: string | null;
}

export interface GovOrg {
  code: string;
  org_class: string;
  org_name: string;
  duties: string;
  common_cases: string;
  phone: string;
  online_channel: string;
  jurisdiction: string;
  note: string;
}

export interface AuditTypeRow {
  code: string;
  name: string;
  description: string;
  period_covered: string;
  legal_basis: string;
}
export interface AuditProcRow {
  code: string;
  name: string;
  step_no: number | null;
  timing: string;
  description: string;
  legal_basis: string;
}

export interface RequiredDoc {
  code: string;
  classification: string;
  doc_name: string;
  description: string;
  prep_time: string;
  retention_period: string;
  legal_basis: string;
  penalty: string;
}

export interface RecruitItem {
  code: string;
  stage: string;
  duty: string;
  description: string;
  violation_examples: string;
  penalty: string;
  applies_to: string;
  legal_basis: string;
  checkpoint: string;
}

export interface LifecycleItem {
  code: string;
  phase: string;
  sub_topic: string;
  requirement: string;
  related_docs: string;
  timing: string;
  legal_basis: string;
  note: string;
}

export interface GuideOverview {
  guide_items: number;
  obligations: number;
  wage_formulas: number;
  glossary: number;
  forms: number;
  orgs: number;
  required_docs: number;
  lifecycle_steps: number;
}

// ─── API 함수 ─────────────────────────────────────────

export const getGuideOverview = () =>
  apiGet<GuideOverview>('/guide/overview');

export const getGuideItems = (opts: { audience?: string; category?: string } = {}) => {
  const q = new URLSearchParams();
  if (opts.audience) q.set('audience', opts.audience);
  if (opts.category) q.set('category', opts.category);
  const qs = q.toString();
  return apiGet<{ items: GuideItem[] }>(`/guide/items${qs ? '?' + qs : ''}`);
};

export const getGlossary = () =>
  apiGet<{ items: GlossaryEntry[] }>('/guide/glossary');

export const getDutiesBySize = (minSize: string) =>
  apiGet<{ size: string; rank: number; duties: SizeDuty[] }>(
    `/guide/by-size/${encodeURIComponent(minSize)}`,
  );

export const getDutiesByStage = (stage: string) =>
  apiGet<{ stage: string; duties: ObligationTimeline[] }>(
    `/guide/by-stage/${encodeURIComponent(stage)}`,
  );

/** 전체 단계별 의무 (28개, 8단계 묶음). 좌측 TOC 그룹화에 사용. */
export const getTimelineAll = () =>
  apiGet<{ items: ObligationTimeline[] }>('/guide/timeline');

export const getForms = (opts: { category?: string } = {}) => {
  const q = new URLSearchParams();
  if (opts.category) q.set('category', opts.category);
  const qs = q.toString();
  return apiGet<{ items: FormTemplate[] }>(`/guide/forms${qs ? '?' + qs : ''}`);
};

export const getWageCalc = (opts: { violation_code?: string } = {}) => {
  const q = new URLSearchParams();
  if (opts.violation_code) q.set('violation_code', opts.violation_code);
  const qs = q.toString();
  return apiGet<{ items: WageCalcFormula[] }>(`/guide/wage-calc${qs ? '?' + qs : ''}`);
};

export const getOrgs = () =>
  apiGet<{ items: GovOrg[] }>('/guide/orgs');

export const getAuditGuide = () =>
  apiGet<{ types: AuditTypeRow[]; procedure: AuditProcRow[] }>('/guide/audit');

export const getRequiredDocs = () =>
  apiGet<{ items: RequiredDoc[] }>('/guide/required-docs');

export const getLifecycle = () =>
  apiGet<{ items: LifecycleItem[] }>('/guide/lifecycle');

export const getRecruit = () =>
  apiGet<{ items: RecruitItem[] }>('/guide/recruit');

export interface GuideChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface RelatedFormHint {
  code: string;
  form_name: string;
  category: string;
  audience: string;
  has_local: boolean;
  purpose: string;
}

export interface GuideChatOut {
  answer: string;
  matched_sources: string[];
  /** 답변 컨텍스트 기반 후속 추천질문 3개 (LLM 생성). 클릭하면 자동 전송. */
  follow_ups: string[];
  /** 질문·답변 주제와 관련된 사업주용 서식 — 챗봇 답변 아래에 다운로드 chip 으로 노출. */
  related_forms: RelatedFormHint[];
  /** 여러 변형이 매칭된 경우 사용자에게 한 번 더 묻는 안내 (예: 근로계약서 유형). null 이면 표시 안 함. */
  clarify: string | null;
}

export const postGuideChat = (
  message: string,
  history: GuideChatTurn[] = [],
) =>
  apiPostJson<GuideChatOut, { message: string; history: GuideChatTurn[] }>(
    '/guide/chat',
    { message, history },
  );
