/**
 * API 클라이언트 — 프론트(브라우저) → Next.js BFF (`/api/cgr/*`) 호출.
 *
 * BFF 가 서버 측에서 `X-API-Key` 를 붙여 백엔드 FastAPI 로 forward 한다.
 * 따라서 브라우저 코드에는 절대 API_KEY 가 노출되지 않는다.
 */
import type { ApiError } from './types';

export class ApiCallError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`API ${status}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

/** BFF 가 동일 origin 의 /api/cgr 로 마운트된다고 가정. */
const BFF_BASE = '/api/cgr';

interface FetchOptions extends RequestInit {
  /** AbortSignal — 폴링·취소용. */
  signal?: AbortSignal;
}

async function parseError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as ApiError;
    return j?.detail ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

/** GET — 일반 JSON 응답. */
export async function apiGet<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const res = await fetch(`${BFF_BASE}${path}`, {
    method: 'GET',
    ...opts,
  });
  if (!res.ok) {
    throw new ApiCallError(res.status, await parseError(res));
  }
  return (await res.json()) as T;
}

/** POST multipart/form-data (파일 업로드용). */
export async function apiPostForm<T>(
  path: string,
  form: FormData,
  opts: FetchOptions = {},
): Promise<T> {
  const res = await fetch(`${BFF_BASE}${path}`, {
    method: 'POST',
    body: form,
    ...opts,
  });
  if (!res.ok) {
    throw new ApiCallError(res.status, await parseError(res));
  }
  return (await res.json()) as T;
}

/** POST JSON. */
export async function apiPostJson<T, B = unknown>(
  path: string,
  body: B,
  opts: FetchOptions = {},
): Promise<T> {
  const res = await fetch(`${BFF_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...opts,
  });
  if (!res.ok) {
    throw new ApiCallError(res.status, await parseError(res));
  }
  return (await res.json()) as T;
}

/**
 * POST JSON → 바이너리 응답 (Blob).
 * 파일 다운로드 (docx 등) — Content-Disposition 헤더 자동 사용.
 *
 * 호출 후 `triggerDownload(blob, filename)` 로 사용자 다운로드 트리거.
 */
export async function apiPostJsonBlob<B = unknown>(
  path: string,
  body: B,
  opts: FetchOptions = {},
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetch(`${BFF_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...opts,
  });
  if (!res.ok) {
    throw new ApiCallError(res.status, await parseError(res));
  }
  const blob = await res.blob();
  // Content-Disposition 에서 filename 파싱 — `filename*=UTF-8''xxx` 우선
  const cd = res.headers.get('Content-Disposition') || '';
  let filename: string | null = null;
  const utfMatch = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch) {
    try {
      filename = decodeURIComponent(utfMatch[1]);
    } catch {
      filename = utfMatch[1];
    }
  } else {
    const plainMatch = cd.match(/filename="?([^";]+)"?/i);
    if (plainMatch) filename = plainMatch[1];
  }
  return { blob, filename };
}

/** Blob 을 사용자 다운로드 — 파일 저장 다이얼로그 트리거. */
export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 다음 tick 에 revoke — 즉시 revoke 면 다운로드 취소되는 브라우저 있음
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
