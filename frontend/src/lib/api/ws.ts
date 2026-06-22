/**
 * 임금명세서 (wage statement) 프론트엔드 API 클라이언트 — beta.
 *
 * 백엔드 라우터: `cgr/api/routes/ws.py`
 *
 * 흐름 (beta — OCR + LLM 판단형 트랙만 우선):
 *   extract  → 파일 → 텍스트
 *   analyze  → 텍스트 + 사업장 컨텍스트 → 11 슬롯 위반 분석 (LLM)
 *   inspect  → 구조화 payslip → V001~V010 계산형 룰엔진  (추후 사용자 확정 단계 UI)
 *
 * EC analyze 와 동일한 출력 스키마(`{riskLevel, overallStatus, results[], ...}`)
 * 라서 프론트 UI 컴포넌트(MetaHoverChip · LawHover · SuggestBlock · ChatPanel) 재사용 가능.
 */
import {
  ApiCallError,
  apiGet,
  apiPostForm,
  apiPostJson,
  apiPostJsonBlob,
  triggerDownload,
} from './client';
import type { EcAnalysisResult } from './types';

/** 폴링 sleep — AbortSignal 지원. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    }
  });
}

/**
 * 공통 폴링 헬퍼 — start 로 job_id 받고 result 를 폴링.
 *
 * 동기 단일 요청은 Render cold start + LLM 시간이 합쳐져 Vercel 60초 함수
 * 타임아웃에 걸려 실패했다 (ec.ts 와 동일 문제·동일 해법):
 *   1) POST .../start 로 job_id 만 즉시 받고 (백엔드는 백그라운드 스레드 실행)
 *   2) GET .../result/{job_id} 를 짧게 폴링 — 각 요청 1초 미만이라 타임아웃 무관
 */
async function pollJob<T>(
  resultPath: (jobId: string) => string,
  jobId: string,
  pick: (res: Record<string, unknown>) => T | undefined,
  opts: { signal?: AbortSignal; label?: string } = {},
): Promise<T> {
  const POLL_MS = 2000;
  const MAX_WAIT_MS = 6 * 60 * 1000;
  const startedAt = Date.now();
  for (;;) {
    await sleep(POLL_MS, opts.signal);
    const res = await apiGet<Record<string, unknown>>(resultPath(jobId), {
      signal: opts.signal,
    });
    const status = res.status as string;
    if (status === 'done') {
      const v = pick(res);
      if (v !== undefined && v !== null) return v;
      throw new ApiCallError(500, `${opts.label ?? '작업'} 결과가 비어있어요. 다시 시도해 주세요.`);
    }
    if (status === 'error') {
      throw new ApiCallError(500, (res.error as string) || `${opts.label ?? '작업'}에 실패했어요. 다시 시도해 주세요.`);
    }
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new ApiCallError(504, `${opts.label ?? '작업'}이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.`);
    }
  }
}

// ─────────────────────────────────────────────────────
// 응답 타입 — 백엔드 Pydantic 모델과 1:1
// ─────────────────────────────────────────────────────
export interface WsExtractOut {
  extracted_text: string;
  filename: string;
  elapsed_sec: number;
  model: string;
}

export interface WsAnalyzeOut {
  analysis_result: EcAnalysisResult; // EC 와 동일 스키마
  elapsed_sec: number;
  model: string;
}

export interface WsCatalogSlot {
  slot_id: string;
  doc: 'wage_statement';
  applicability: {
    business_size: 'any' | '5+' | '5-';
    worker_types: string[] | 'any';
  };
  field: string;
  required_content: string;
  purpose: string;
  topic_meta: string[];
  laws: string[];
  comparator: 'presence';
  missing_severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  violation_severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  fix_example: string;
}

export interface WsCatalogOut {
  version: string;
  doc: 'wage_statement';
  description: string;
  slots: WsCatalogSlot[];
}

// 룰엔진 (계산형) — 추후 구조화 입력 UI 가 생기면 활성
export interface WsViolationFinding {
  violation_code: string;
  violation_name: string;
  severity: 'HIGH' | 'MID' | 'LOW';
  payslip_line_id: number | null;
  detected_value: string;
  expected_value: string;
  difference_amount: number;
  detail_description: string;
  status: 'OPEN' | 'FIXED' | 'IGNORED';
  recommendation_text: string;
}

export interface WsInspectionResult {
  run_uid: string | null;
  ruleset_version: string;
  minimum_wage_year: number;
  overall_status: 'OK' | 'WARN' | 'VIOLATION';
  total_violations: number;
  findings: WsViolationFinding[];
  elapsed_sec: number;
}

export interface WsInspectOut {
  result: WsInspectionResult;
  run_uid: string | null;
  persisted: boolean;
}

// ─────────────────────────────────────────────────────
// 클라이언트 함수
// ─────────────────────────────────────────────────────

/** 1단계: 파일 → 텍스트 (이미지면 OCR) — 비동기 잡(start + poll). */
export async function postWsExtract(
  file: File,
  opts: { signal?: AbortSignal; caseId?: string; service?: string } = {},
): Promise<WsExtractOut> {
  const form = new FormData();
  form.append('file', file);
  // 원본 파일을 서버에 보관해 관리자 로그와 연결 (case_id). service 인자는 시그니처 통일용(무시됨).
  if (opts.caseId) form.append('case_id', opts.caseId);
  const { job_id } = await apiPostForm<{ job_id: string }>('/ws/extract/start', form, {
    signal: opts.signal,
  });
  return pollJob<WsExtractOut>(
    (id) => `/ws/extract/result/${id}`,
    job_id,
    (res) =>
      res.extracted_text != null
        ? ({
            extracted_text: res.extracted_text as string,
            filename: (res.filename as string) ?? '',
            elapsed_sec: (res.elapsed_sec as number) ?? 0,
            model: (res.model as string) ?? '',
          } as WsExtractOut)
        : undefined,
    { signal: opts.signal, label: '문서 추출' },
  );
}

/** 임금명세서 AI 1차 분류 결과 — 계약 유형 + 산정기간·지급주기 추출. */
export interface WsClassifyOut {
  contract_type: string; // 정규직 / 기간제 / 단시간 / 일용직
  pay_period_year: number | null; // 명세서에 없으면 null → 분석에서 누락 위반
  pay_period_month: number | null;
  pay_cycle: string | null; // 월급 / 시급 / 일급 | null
  weekly_hours: number | null;
  doc_kind: string;
  reason: string;
}

/**
 * 임금명세서 계약 유형 AI 1차 분류 — start + poll.
 * 사용자는 분석 직전 [맞아요/아니에요]로 확인만 한다 (EC 근로자 유형과 동일 UX).
 */
export async function postWsClassify(
  extractedText: string,
  opts: { signal?: AbortSignal } = {},
): Promise<WsClassifyOut> {
  const { job_id } = await apiPostJson<{ job_id: string }>(
    '/ws/classify/start',
    { extracted_text: extractedText },
    { signal: opts.signal },
  );
  return pollJob<WsClassifyOut>(
    (id) => `/ws/classify/result/${id}`,
    job_id,
    (res) =>
      res.contract_type != null
        ? {
            contract_type: res.contract_type as string,
            pay_period_year: (res.pay_period_year as number | null) ?? null,
            pay_period_month: (res.pay_period_month as number | null) ?? null,
            pay_cycle: (res.pay_cycle as string | null) ?? null,
            weekly_hours: (res.weekly_hours as number | null) ?? null,
            doc_kind: (res.doc_kind as string) ?? '',
            reason: (res.reason as string) ?? '',
          }
        : undefined,
    { signal: opts.signal, label: '문서 분류' },
  );
}

/** 2단계: 임금명세서 원문 + 컨텍스트 → 11 슬롯 위반 분석 (LLM). */
export async function postWsAnalyze(
  body: {
    wage_text: string;
    business_size?: string;
    worker_types?: string[];
    /** 산정 대상 연도 — 최저임금 기준. */
    pay_period_year?: number;
    /** 산정 대상 월 (1~12). */
    pay_period_month?: number;
    /** 계약 유형 — 정규직 / 기간제 / 단시간 / 일용직. */
    contract_type?: string;
    /** 임금 지급 주기 — 월급 / 시급 / 일급. */
    pay_cycle?: string;
    /** 주 소정근로시간 (단시간일 때 의미 있음). */
    weekly_hours?: number;
    /** 리뷰 세션 id — 올린 원본 명세서 파일을 관리자 로그와 연결. */
    case_id?: string;
  },
  opts: { signal?: AbortSignal } = {},
): Promise<WsAnalyzeOut> {
  const { job_id } = await apiPostJson<{ job_id: string }>('/ws/analyze/start', body, {
    signal: opts.signal,
  });
  return pollJob<WsAnalyzeOut>(
    (id) => `/ws/analyze/result/${id}`,
    job_id,
    (res) =>
      res.analysis_result != null
        ? ({
            analysis_result: res.analysis_result as unknown as EcAnalysisResult,
            elapsed_sec: (res.elapsed_sec as number) ?? 0,
            model: (res.model as string) ?? '',
          } as WsAnalyzeOut)
        : undefined,
    { signal: opts.signal, label: '검토 분석' },
  );
}

/** 3단계 (beta 다음): 구조화 payslip → 계산형 룰엔진. */
export async function postWsInspect(
  body: {
    payslip: {
      pay_period_year: number;
      pay_period_month?: number;
      document_id?: number | null;
      worker_name?: string | null;
      payment_date?: string | null;
      total_work_hours?: number | null;
      overtime_hours?: number | null;
      night_hours?: number | null;
      holiday_hours?: number | null;
      total_gross?: number | null;
      total_deduction?: number | null;
      total_net?: number | null;
      lines: Array<{
        line_type: 'PAYMENT' | 'DEDUCTION';
        item_code?: string | null;
        item_name_original: string;
        amount: number;
        calculation_basis?: string | null;
        is_ordinary_wage_final?: boolean | null;
      }>;
    };
    persist?: boolean;
  },
  opts: { signal?: AbortSignal } = {},
): Promise<WsInspectOut> {
  return apiPostJson<WsInspectOut>('/ws/inspect', body, opts);
}

/** 2-b 단계: 분석 결과 → 수정된 표준 임금명세서 텍스트. */
export interface WsGenerateOut {
  wage_text: string;
  elapsed_sec: number;
  model: string;
}

export async function postWsGenerate(
  body: {
    analysis_result: import('./types').EcAnalysisResult;
    wage_text: string;
    user_overrides?: Record<string, string>;
  },
  opts: { signal?: AbortSignal } = {},
): Promise<WsGenerateOut> {
  // 동기 /ws/generate 는 LLM 생성 시간이 길어 Vercel 함수 타임아웃에 걸렸다.
  // EC·analyze 와 동일하게 비동기 잡(start + poll)로 우회.
  const { job_id } = await apiPostJson<{ job_id: string }>(
    '/ws/generate/start',
    body,
    { signal: opts.signal },
  );
  return pollJob<WsGenerateOut>(
    (id) => `/ws/generate/result/${id}`,
    job_id,
    (res) =>
      res.wage_text != null
        ? ({
            wage_text: res.wage_text as string,
            elapsed_sec: (res.elapsed_sec as number) ?? 0,
            model: (res.model as string) ?? '',
          } as WsGenerateOut)
        : undefined,
    { signal: opts.signal, label: '표준 명세서 생성' },
  );
}

// ─── 구조화 임금명세서 (공식 서식 칸 바인딩용) ───
export interface WagePayLine {
  name: string;
  amount: string;
  basis?: string;
  supplemented?: boolean;
}

export interface WsPayslipForm {
  settlementPeriod: string;
  paymentDate: string;
  deliveryMethod: string;
  worker: { name?: string; idOrBirth?: string; dept?: string; position?: string };
  employer: { company?: string; businessNo?: string; ceo?: string; address?: string };
  workTime: { days?: string; hours?: string; overtime?: string; night?: string; holiday?: string };
  payments: WagePayLine[];
  paymentTotal: string;
  deductions: WagePayLine[];
  deductionTotal: string;
  netPay: string;
  /** 머리말 칸 중 보완된 키 (deliveryMethod, employer …) — 하이라이트용. */
  supplementedFields: string[];
  notes: string[];
}

/** 2-b'' 단계: 분석 결과 → 공식 임금명세서 서식 칸을 채운 구조화 JSON. */
export async function postWsGenerateForm(
  body: {
    analysis_result: import('./types').EcAnalysisResult;
    wage_text: string;
    user_overrides?: Record<string, string>;
  },
  opts: { signal?: AbortSignal } = {},
): Promise<WsPayslipForm> {
  const { job_id } = await apiPostJson<{ job_id: string }>(
    '/ws/generate-form/start',
    body,
    { signal: opts.signal },
  );
  return pollJob<WsPayslipForm>(
    (id) => `/ws/generate-form/result/${id}`,
    job_id,
    (res) => (res.form != null ? (res.form as unknown as WsPayslipForm) : undefined),
    { signal: opts.signal, label: '표준 명세서 생성' },
  );
}

/**
 * 2-c 단계: 평문 본문 → .docx 다운로드.
 *
 * 백엔드가 docx 바이트 + Content-Disposition 헤더 반환.
 * 호출 즉시 사용자 다운로드 트리거.
 */
export async function downloadWsDocx(
  body: { wage_text: string; filename?: string },
): Promise<void> {
  const fname = body.filename ?? '표준_임금명세서.docx';
  const { blob, filename } = await apiPostJsonBlob('/ws/generate-docx', body);
  triggerDownload(blob, filename ?? fname);
}

/** 2-d 단계: 구조화 form → 공식 임금명세서 서식 표 .docx (화면 양식과 동일 레이아웃). */
export async function downloadWsFormDocx(
  form: WsPayslipForm,
  filename = '표준_임금명세서.docx',
): Promise<void> {
  const { blob, filename: fn } = await apiPostJsonBlob('/ws/generate-docx-form', {
    form,
    filename,
  });
  triggerDownload(blob, fn ?? filename);
}

/** 슬롯 카탈로그 조회 (디버그·관리자용). */
export async function getWsCatalog(
  opts: { signal?: AbortSignal } = {},
): Promise<WsCatalogOut> {
  return apiGet<WsCatalogOut>('/ws/catalog', opts);
}
