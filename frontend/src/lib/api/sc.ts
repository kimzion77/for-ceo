/**
 * 노무제공자 계약서 (Service Provider Contract) — 3단계 API 클라이언트.
 *
 * 백엔드 라우터: `cgr/api/routes/sc.py`
 *
 * 흐름:
 *   extract → structure → (사용자 검토·수정) → analyze
 *
 * EC 와 유사한 패턴이나 SC 는 generate 단계가 없습니다 (1차) — 노무제공계약서는
 * 표준 양식이 고용노동부 자료실에 외부 URL 로 제공되므로 가이드 페이지의
 * `form_template.download_url` 로 안내합니다.
 */
import { apiPostForm, apiPostJson } from './client';

/** 슬롯의 한 값 — value + (LLM 또는 사용자 메모) */
export interface ScSlotValue {
  value: string;
  note: string;
}

/** 4섹션·16슬롯 구조화 데이터. */
export interface ScStructuredData {
  당사자정보: {
    사업주: ScSlotValue;
    노무제공자: ScSlotValue;
    적용직종: ScSlotValue;
  };
  계약기본: {
    계약기간: ScSlotValue;
    노무제공장소: ScSlotValue;
    업무내용: ScSlotValue;
    노무제공방식: ScSlotValue;
  };
  보수및사회보험: {
    보수: ScSlotValue;
    보수지급일: ScSlotValue;
    산재보험: ScSlotValue;
    고용보험: ScSlotValue;
  };
  보호및분쟁: {
    안전보건의무: ScSlotValue;
    계약해지: ScSlotValue;
    손해배상책임: ScSlotValue;
    분쟁해결: ScSlotValue;
    근로자성위장방지: ScSlotValue;
  };
  기타사항: Array<{ 항목: string; 내용: string }>;
}

export interface ScAnalysisFinding {
  슬롯ID: string;
  항목: string;
  적용조건: string;
  적절성: '적절' | '부적절' | '보완필요';
  발견내용: string;
  판단이유: string;
  법적근거: string;
  개선권고: string;
  심각도: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ScAnalysisResult {
  riskLevel: '상' | '중' | '하';
  overallStatus: '위험' | '보완필요' | '적정';
  overallOpinion: string;
  results: ScAnalysisFinding[];
  finalRecommendations: string;
}

export interface ScExtractOut {
  extracted_text: string;
  filename: string;
  elapsed_sec: number;
  model: string;
}

export interface ScStructureOut {
  structured_data: ScStructuredData;
  elapsed_sec: number;
  model: string;
}

export interface ScAnalyzeOut {
  analysis_result: ScAnalysisResult;
  elapsed_sec: number;
  model: string;
}

/** 1단계: 파일 → 텍스트 (이미지면 OCR). */
export async function postScExtract(
  file: File,
  opts: { signal?: AbortSignal } = {},
): Promise<ScExtractOut> {
  const form = new FormData();
  form.append('file', file);
  return apiPostForm<ScExtractOut>('/sc/extract', form, { signal: opts.signal });
}

/** 2단계: 텍스트 → 4섹션·16슬롯 구조화 JSON. */
export async function postScStructure(
  extractedText: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ScStructureOut> {
  return apiPostJson<ScStructureOut>(
    '/sc/structure',
    { extracted_text: extractedText },
    { signal: opts.signal },
  );
}

/** 3단계: 구조화 데이터 + 컨텍스트 → 16 슬롯 위반 분석. */
export async function postScAnalyze(
  structuredData: ScStructuredData,
  opts: {
    workerSubtype?: string;
    businessSize?: string;
    signal?: AbortSignal;
  } = {},
): Promise<ScAnalyzeOut> {
  return apiPostJson<ScAnalyzeOut>(
    '/sc/analyze',
    {
      structured_data: structuredData,
      worker_subtype: opts.workerSubtype ?? '',
      business_size: opts.businessSize ?? '',
    },
    { signal: opts.signal },
  );
}
