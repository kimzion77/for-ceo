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
import { apiGet, apiPostForm, apiPostJson, apiPostJsonBlob, triggerDownload } from './client';
import type { EcAnalysisResult } from './types';

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

/** 1단계: 파일 → 텍스트 (이미지면 OCR). */
export async function postWsExtract(
  file: File,
  opts: { signal?: AbortSignal } = {},
): Promise<WsExtractOut> {
  const form = new FormData();
  form.append('file', file);
  return apiPostForm<WsExtractOut>('/ws/extract', form, { signal: opts.signal });
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
  },
  opts: { signal?: AbortSignal } = {},
): Promise<WsAnalyzeOut> {
  return apiPostJson<WsAnalyzeOut>('/ws/analyze', body, opts);
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
  return apiPostJson<WsGenerateOut>('/ws/generate', body, opts);
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

/** 슬롯 카탈로그 조회 (디버그·관리자용). */
export async function getWsCatalog(
  opts: { signal?: AbortSignal } = {},
): Promise<WsCatalogOut> {
  return apiGet<WsCatalogOut>('/ws/catalog', opts);
}
