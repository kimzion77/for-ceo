/**
 * 근로계약서 풀 이식 — 4단계 API 클라이언트.
 *
 * 기존 `1. 근로계약서/기존/src/api/contractApi.js` 와 1:1 매핑.
 * 백엔드 라우터: `cgr/api/routes/ec.py`
 *
 * 흐름:
 *   extract → structure → (사용자 검토·수정) → analyze → generate
 *
 * 각 단계가 독립 호출 가능하므로 사용자가 검토 페이지에서 머무는 동안
 * 클라이언트 메모리에 결과를 보관 (reviewStore) 한 뒤 다음 단계로 진행.
 */
import { apiPostForm, apiPostJson, apiPostJsonBlob, triggerDownload } from './client';
import type {
  EcAnalyzeOut,
  EcAnalysisResult,
  EcChatOut,
  EcChatTurn,
  EcExtractOut,
  EcGenerateOut,
  EcStructureOut,
  EcStructuredData,
} from './types';

/** 1단계: 파일 → 텍스트 (이미지면 OCR). */
export async function postEcExtract(
  file: File,
  opts: { signal?: AbortSignal } = {},
): Promise<EcExtractOut> {
  const form = new FormData();
  form.append('file', file);
  return apiPostForm<EcExtractOut>('/ec/extract', form, { signal: opts.signal });
}

/** 2단계: 텍스트 → 8섹션 구조화 JSON. */
export async function postEcStructure(
  extractedText: string,
  opts: { signal?: AbortSignal } = {},
): Promise<EcStructureOut> {
  return apiPostJson<EcStructureOut>(
    '/ec/structure',
    { extracted_text: extractedText },
    { signal: opts.signal },
  );
}

/** 3단계: 사용자가 검토 완료한 구조화 데이터 + 컨텍스트 → 33매핑 분석 결과. */
export async function postEcAnalyze(
  structuredData: EcStructuredData,
  businessSize: string,
  workerTypes: string[],
  opts: { legalGuidelines?: string; signal?: AbortSignal } = {},
): Promise<EcAnalyzeOut> {
  return apiPostJson<EcAnalyzeOut>(
    '/ec/analyze',
    {
      structured_data: structuredData,
      business_size: businessSize,
      worker_types: workerTypes,
      legal_guidelines: opts.legalGuidelines ?? '',
    },
    { signal: opts.signal },
  );
}

/** 4단계: 분석 결과 → 표준 근로계약서 텍스트.
 *
 * `userOverrides` 는 사용자가 SuggestBlock 으로 직접 작성한 보완 표현
 * (항목명 → 본인 입력 텍스트). 백엔드 프롬프트의 별도 섹션으로 전달되어
 * 표준 계약서 본문에 그대로 반영된다.
 */
export async function postEcGenerate(
  analysisResult: EcAnalysisResult,
  opts: {
    userOverrides?: Record<string, string>;
    signal?: AbortSignal;
  } = {},
): Promise<EcGenerateOut> {
  return apiPostJson<EcGenerateOut>(
    '/ec/generate',
    {
      analysis_result: analysisResult,
      user_overrides: opts.userOverrides ?? {},
    },
    { signal: opts.signal },
  );
}

/** 5단계(부가): 결과 페이지에서 사용자가 던지는 후속 질문에 LLM 이 답변. */
export async function postEcChat(
  message: string,
  opts: {
    analysisResult?: EcAnalysisResult;
    focusedItem?: string;
    history?: EcChatTurn[];
    signal?: AbortSignal;
  } = {},
): Promise<EcChatOut> {
  return apiPostJson<EcChatOut>(
    '/ec/chat',
    {
      message,
      analysis_result: opts.analysisResult ?? null,
      focused_item: opts.focusedItem ?? null,
      history: opts.history ?? [],
    },
    { signal: opts.signal },
  );
}


/** 표준 근로계약서 본문 → .docx 다운로드. */
export async function downloadEcDocx(
  body: { contract_text: string; filename?: string },
): Promise<void> {
  const fname = body.filename ?? '표준_근로계약서.docx';
  const { blob, filename } = await apiPostJsonBlob('/ec/generate-docx', body);
  triggerDownload(blob, filename ?? fname);
}
