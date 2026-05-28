/**
 * 검토 API — `/api/cgr/review` (BFF) 를 통한 POST/GET.
 *
 * 문서 종류(document_type) 분기:
 *  - 'work_rules' (기본) → ReviewFullOut (5-Bucket)
 *  - 'employment_contract' → EcReviewOut (3-Bucket)
 */
import { apiPostForm, apiGet } from './client';
import { mapReviewResult } from './mappers';
import type {
  AnyReviewOut,
  EcReviewOut,
  ReviewSummaryOut,
} from './types';
import { isEcReview } from './types';
import type { DocumentType, ReviewResult, WorkplaceContext } from '@/types/review';

/** boolean | null → multipart Form 값 ("true"/"false"/null). */
function boolToFormValue(v: boolean | null): string {
  if (v === null) return '';
  return v ? 'true' : 'false';
}

/** 프론트 DocumentType → 백엔드 document_type 문자열. */
function mapDocumentType(d: DocumentType): string {
  switch (d) {
    case 'work-rules':
      return 'work_rules';
    case 'employment-contract':
      return 'employment_contract';
    case 'wage-statement':
      return 'pay_statement';
    case 'service-provider-contract':
      // SC 는 단일 호출 review 엔드포인트를 쓰지 않고 /sc/* 3단계로 분리되어 있어
      // 이 함수는 호출되지 않지만 타입 완전성을 위해 백엔드 코드명 명시.
      return 'service_provider_contract';
  }
}

export interface PostReviewOptions {
  files: File[];
  context: WorkplaceContext;
  documentType?: DocumentType;
  signal?: AbortSignal;
}

/** 취업규칙 검토 — 결과를 프론트 `ReviewResult` 형식으로 변환. */
export async function postReviewWorkRules(opts: PostReviewOptions): Promise<ReviewResult> {
  const out = await postReviewRaw(opts);
  if (isEcReview(out)) {
    throw new Error('근로계약서 응답을 받았으나 취업규칙 결과를 기대했습니다.');
  }
  return mapReviewResult(out);
}

/** 근로계약서 검토 — 백엔드 응답을 그대로 반환 (3-Bucket). */
export async function postReviewEmploymentContract(
  opts: PostReviewOptions,
): Promise<EcReviewOut> {
  const out = await postReviewRaw(opts);
  if (!isEcReview(out)) {
    throw new Error('취업규칙 응답을 받았으나 근로계약서 결과를 기대했습니다.');
  }
  return out;
}

/** 공통 POST — document_type 으로 백엔드가 분기. */
export async function postReviewRaw(opts: PostReviewOptions): Promise<AnyReviewOut> {
  const { files, context, documentType = 'work-rules', signal } = opts;
  if (files.length === 0) {
    throw new Error('파일이 비어있습니다.');
  }

  const form = new FormData();
  form.append('file', files[0]);
  form.append('document_type', mapDocumentType(documentType));

  // 취업규칙용
  form.append('shift_work_used', boolToFormValue(context.shiftWorkUsed));
  form.append('osha_applicable', boolToFormValue(context.oshaApplicable));
  form.append('chemical_handling', boolToFormValue(context.chemicalHandling));
  form.append('workenv_measurement', boolToFormValue(context.workenvMeasurement));

  // 근로계약서·임금명세서용
  form.append('business_size', context.businessSize ?? '');
  form.append('worker_types', context.workerTypes.join(','));

  return apiPostForm<AnyReviewOut>('/review', form, { signal });
}

/** legacy alias — 기존 호출처 호환. */
export const postReview = postReviewWorkRules;

/** GET /review/{case_id} — 이력 요약 조회. */
export async function getReviewSummary(caseId: string): Promise<ReviewSummaryOut> {
  return apiGet<ReviewSummaryOut>(`/review/${encodeURIComponent(caseId)}`);
}

/** 응답 자체를 분기 처리하는 헬퍼 export. */
export { isEcReview, type AnyReviewOut, type EcReviewOut };
