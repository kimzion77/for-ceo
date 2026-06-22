/**
 * API 클라이언트 — 프론트(브라우저) → Next.js BFF (`/api/cgr/*`) 호출.
 *
 * BFF 가 서버 측에서 `X-API-Key` 를 붙여 백엔드 FastAPI 로 forward 한다.
 * 따라서 브라우저 코드에는 절대 API_KEY 가 노출되지 않는다.
 */
import { BASE_PATH } from '@/lib/basePath';

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

/** BFF 가 동일 origin 의 /api/cgr 로 마운트. 하위경로 배포(/for-ceo) 시 BASE_PATH 가 앞에 붙는다. */
const BFF_BASE = `${BASE_PATH}/api/cgr`;

interface FetchOptions extends RequestInit {
  /** AbortSignal — 폴링·취소용. */
  signal?: AbortSignal;
}

async function parseError(res: Response): Promise<string> {
  // 응답이 truncated 면 json() 이 'Unterminated string in JSON...' 으로 throw.
  // text() 로 먼저 받아서 길이 체크하고 직접 파싱 시도.
  let raw = '';
  try {
    raw = await res.text();
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
  if (!raw) return res.statusText || `HTTP ${res.status}`;
  try {
    const j = JSON.parse(raw) as ApiError;
    return j?.detail ?? res.statusText;
  } catch {
    // 본문이 JSON 이 아님 — HTML 에러 페이지(504 등) 또는 truncated
    if (raw.length < 1000) return raw.slice(0, 300);
    return `응답이 도중에 끊겼어요 (${raw.length}자, 게이트웨이 타임아웃 가능성). 잠시 후 다시 시도해 주세요.`;
  }
}

/**
 * res.json() 안전 래퍼 — truncated JSON 에 대해 사용자 친화적 메시지로 변환.
 *
 * Vercel BFF 가 백엔드 응답을 forward 할 때 upstream connection 이 끊기거나
 * 함수 타임아웃에 걸리면 body 가 도중에 잘려 도착함. 그대로 JSON.parse 하면
 * 'Unterminated string in JSON at position N' 으로 죽는데, 이 메시지는 사용자
 * 입장에서 무의미하므로 한국어 메시지로 치환.
 */
async function safeReadJson<T>(res: Response): Promise<T> {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    const len = raw.length;
    throw new ApiCallError(
      502,
      `응답이 도중에 끊겼어요 (${len}자 수신, JSON 파싱 실패). ` +
        `백엔드 처리 시간이 길어 게이트웨이가 연결을 끊었을 수 있어요. ` +
        `잠시 후 다시 시도해 주세요.`,
    );
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
  return safeReadJson<T>(res);
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
  return safeReadJson<T>(res);
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
  return safeReadJson<T>(res);
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
