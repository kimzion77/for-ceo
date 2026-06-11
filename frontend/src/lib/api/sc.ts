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
import { ApiCallError, apiGet, apiPostForm, apiPostJson } from './client';

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

/** 1단계: 파일 → 텍스트 (이미지면 OCR) — 비동기 잡(start + poll). */
export async function postScExtract(
  file: File,
  opts: { signal?: AbortSignal } = {},
): Promise<ScExtractOut> {
  const form = new FormData();
  form.append('file', file);
  const { job_id } = await apiPostForm<{ job_id: string }>('/sc/extract/start', form, {
    signal: opts.signal,
  });
  return pollJob<ScExtractOut>(
    (id) => `/sc/extract/result/${id}`,
    job_id,
    (res) =>
      res.extracted_text != null
        ? ({
            extracted_text: res.extracted_text as string,
            filename: (res.filename as string) ?? '',
            elapsed_sec: (res.elapsed_sec as number) ?? 0,
            model: (res.model as string) ?? '',
          } as ScExtractOut)
        : undefined,
    { signal: opts.signal, label: '문서 추출' },
  );
}

/** 2단계: 텍스트 → 4섹션·16슬롯 구조화 JSON — 비동기 잡(start + poll). */
export async function postScStructure(
  extractedText: string,
  opts: { signal?: AbortSignal } = {},
): Promise<ScStructureOut> {
  const { job_id } = await apiPostJson<{ job_id: string }>(
    '/sc/structure/start',
    { extracted_text: extractedText },
    { signal: opts.signal },
  );
  return pollJob<ScStructureOut>(
    (id) => `/sc/structure/result/${id}`,
    job_id,
    (res) =>
      res.structured_data != null
        ? ({
            structured_data: res.structured_data as unknown as ScStructuredData,
            elapsed_sec: (res.elapsed_sec as number) ?? 0,
            model: (res.model as string) ?? '',
          } as ScStructureOut)
        : undefined,
    { signal: opts.signal, label: '문서 정리' },
  );
}

/** 3단계: 구조화 데이터 + 컨텍스트 → 16 슬롯 위반 분석 — 비동기 잡(start + poll). */
export async function postScAnalyze(
  structuredData: ScStructuredData,
  opts: {
    workerSubtype?: string;
    businessSize?: string;
    signal?: AbortSignal;
  } = {},
): Promise<ScAnalyzeOut> {
  const { job_id } = await apiPostJson<{ job_id: string }>(
    '/sc/analyze/start',
    {
      structured_data: structuredData,
      worker_subtype: opts.workerSubtype ?? '',
      business_size: opts.businessSize ?? '',
    },
    { signal: opts.signal },
  );
  return pollJob<ScAnalyzeOut>(
    (id) => `/sc/analyze/result/${id}`,
    job_id,
    (res) =>
      res.analysis_result != null
        ? ({
            analysis_result: res.analysis_result as unknown as ScAnalysisResult,
            elapsed_sec: (res.elapsed_sec as number) ?? 0,
            model: (res.model as string) ?? '',
          } as ScAnalyzeOut)
        : undefined,
    { signal: opts.signal, label: '검토 분석' },
  );
}
