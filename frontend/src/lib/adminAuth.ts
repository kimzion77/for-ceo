/**
 * 관리자 세션 — 서명된 httpOnly 쿠키(HMAC-SHA256). 서버 전용(Node 런타임).
 *
 * 로그인 라우트가 비밀번호 검증 후 signSession() 토큰을 쿠키에 굽고, BFF 가
 * admin 경로 요청마다 verifySession() 으로 검증한 뒤에만 ADMIN_API_KEY 를 주입한다.
 * 시크릿: process.env.ADMIN_SESSION_SECRET.
 */
import crypto from 'crypto';

export const ADMIN_COOKIE = 'admin_session';
const TTL_MS = 12 * 60 * 60 * 1000; // 12시간

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || '';
}

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

export function signSession(): string {
  const payload = b64url(JSON.stringify({ exp: Date.now() + TTL_MS }));
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined | null): boolean {
  const s = secret();
  if (!token || !s) return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', s).update(payload).digest('base64url');
  if (sig.length !== expect.length) return false;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    return typeof exp === 'number' && Date.now() < exp;
  } catch {
    return false;
  }
}

export const SESSION_MAX_AGE = Math.floor(TTL_MS / 1000);
