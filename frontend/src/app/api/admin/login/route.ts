/**
 * 관리자 로그인/세션 — /api/admin/login
 *
 *  POST   { password }  → ADMIN_PASSWORD 와 일치하면 서명 쿠키(admin_session) 발급
 *  GET                  → 현재 세션 유효 여부 { authed }
 *  DELETE               → 로그아웃 (쿠키 제거)
 *
 * 비밀번호·시크릿은 서버 환경변수(Vercel)로만 관리 — 클라이언트 노출 없음.
 * 실제 관리자 API(/api/cgr/admin/*) 보호는 BFF 의 세션 게이트가 담당한다.
 */
import crypto from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from '@/lib/adminAuth';

export const runtime = 'nodejs';

/** 타이밍 안전 비교 — sha256 해시 후 고정 길이로 비교(길이·내용 타이밍 노출 차단). */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ─── 무차별 대입(brute-force) 방지 — IP별 실패 횟수 + 잠금 (인메모리) ───
const _attempts = new Map<string, { fails: number; until: number }>();
const _MAX_FAILS = 8;
const _LOCK_MS = 10 * 60 * 1000; // 8회 실패 시 10분 잠금

function _clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || 'unknown';
}

export async function POST(req: NextRequest) {
  const ip = _clientIp(req);
  const now = Date.now();
  const rec = _attempts.get(ip);
  if (rec && rec.until > now) {
    return NextResponse.json(
      { ok: false, detail: '로그인 시도가 많아 잠시 차단됐어요. 잠시 후 다시 시도해 주세요.' },
      { status: 429 },
    );
  }

  // trim — Vercel 값에 끼어든 후행 공백/줄바꿈으로 비교가 깨지는 흔한 사고 방지
  const expected = (process.env.ADMIN_PASSWORD || '').trim();
  if (!expected || !(process.env.ADMIN_SESSION_SECRET || '').trim()) {
    return NextResponse.json(
      { ok: false, detail: '관리자 로그인이 설정되지 않았어요 (ADMIN_PASSWORD/ADMIN_SESSION_SECRET 미설정).' },
      { status: 503 },
    );
  }
  let password = '';
  try {
    const body = await req.json();
    password = typeof body?.password === 'string' ? body.password : '';
  } catch {
    password = '';
  }
  if (!password.trim() || !safeEqual(password.trim(), expected)) {
    const r = _attempts.get(ip) || { fails: 0, until: 0 };
    r.fails += 1;
    if (r.fails >= _MAX_FAILS) {
      r.until = now + _LOCK_MS;
      r.fails = 0;
    }
    _attempts.set(ip, r);
    return NextResponse.json({ ok: false, detail: '비밀번호가 올바르지 않아요.' }, { status: 401 });
  }
  _attempts.delete(ip); // 성공 → 실패 카운터 초기화
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, signSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

export async function GET(req: NextRequest) {
  const authed = verifySession(req.cookies.get(ADMIN_COOKIE)?.value);
  return NextResponse.json({ authed });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
