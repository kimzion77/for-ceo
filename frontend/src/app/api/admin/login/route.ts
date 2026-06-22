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
import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from '@/lib/adminAuth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
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
  if (!password.trim() || password.trim() !== expected) {
    return NextResponse.json({ ok: false, detail: '비밀번호가 올바르지 않아요.' }, { status: 401 });
  }
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
