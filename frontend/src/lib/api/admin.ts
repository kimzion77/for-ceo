/**
 * 관리자 대시보드 API 클라이언트.
 *
 * - 세션(로그인/확인/로그아웃): Next 라우트 `/api/admin/login`
 * - 데이터(통계·업로드·프롬프트): BFF `/api/cgr/admin/*` (서버가 ADMIN_API_KEY 주입)
 *   — 단, 유효한 admin_session 쿠키가 없으면 BFF 가 401.
 */

export interface AdminAnalytics {
  total_visits: number;
  dau: number;
  wau: number;
  mau: number;
  total_uploads: number;
  daily: { d: string; visits: number; users: number }[];
  uploads_by_service: Record<string, number>;
}

export interface UploadRow {
  id: number;
  ts: string;
  service: string;
  filename: string;
  size: number;
  mime: string;
  ext: string;
  visitor: string;
  case_id: string;
  has_file: boolean;
}

export interface PromptItem {
  key: string;
  label: string;
  group: string;
  content: string;
  error?: string;
}

async function jsonOrThrow(res: Response): Promise<any> {
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    /* noop */
  }
  if (!res.ok) {
    throw new Error(data?.detail || `요청 실패 (${res.status})`);
  }
  return data;
}

// ─── 세션 ───
export async function checkAdminSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/login', { method: 'GET', cache: 'no-store' });
    const data = await res.json().catch(() => ({ authed: false }));
    return Boolean(data?.authed);
  } catch {
    return false;
  }
}

export async function adminLogin(password: string): Promise<void> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  await jsonOrThrow(res);
}

export async function adminLogout(): Promise<void> {
  await fetch('/api/admin/login', { method: 'DELETE' });
}

// ─── 데이터 ───
export async function getAnalytics(): Promise<AdminAnalytics> {
  return jsonOrThrow(await fetch('/api/cgr/admin/analytics', { cache: 'no-store' }));
}

export async function getUploads(
  opts: { limit?: number; offset?: number; service?: string } = {},
): Promise<{ items: UploadRow[]; total: number }> {
  const q = new URLSearchParams();
  q.set('limit', String(opts.limit ?? 100));
  q.set('offset', String(opts.offset ?? 0));
  if (opts.service) q.set('service', opts.service);
  return jsonOrThrow(
    await fetch(`/api/cgr/admin/uploads?${q.toString()}`, { cache: 'no-store' }),
  );
}

export function uploadFileUrl(id: number): string {
  return `/api/cgr/admin/uploads/${id}/file`;
}

export async function getPrompts(): Promise<PromptItem[]> {
  const data = await jsonOrThrow(
    await fetch('/api/cgr/admin/prompts', { cache: 'no-store' }),
  );
  return data?.prompts ?? [];
}

export async function savePrompt(key: string, content: string): Promise<void> {
  const res = await fetch('/api/cgr/admin/prompts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, content }),
  });
  await jsonOrThrow(res);
}

// ─── 상호작용 로그 ───
export interface LogRow {
  id: number;
  ts: string;
  kind: string;
  model: string;
  visitor: string;
  input_preview: string;
  output_preview: string;
}

export interface LogUpload {
  id: number;
  filename: string;
  mime: string;
  ext: string;
  size: number;
  has_file: boolean;
}

export interface LogDetail {
  id: number;
  ts: string;
  kind: string;
  model: string;
  visitor: string;
  input_text: string;
  output_text: string;
  case_id?: string | null;
  upload_id?: number | null;
  upload?: LogUpload | null;
}

export async function getLogs(
  opts: { limit?: number; offset?: number; kind?: string } = {},
): Promise<{ items: LogRow[]; total: number }> {
  const q = new URLSearchParams();
  q.set('limit', String(opts.limit ?? 100));
  q.set('offset', String(opts.offset ?? 0));
  if (opts.kind) q.set('kind', opts.kind);
  return jsonOrThrow(await fetch(`/api/cgr/admin/logs?${q.toString()}`, { cache: 'no-store' }));
}

export async function getLog(id: number): Promise<LogDetail> {
  return jsonOrThrow(await fetch(`/api/cgr/admin/logs/${id}`, { cache: 'no-store' }));
}
