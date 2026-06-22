/** @type {import('next').NextConfig} */
// 하위경로 배포(예: moellab.info/for-ceo)는 빌드 시 NEXT_PUBLIC_BASE_PATH=/for-ceo.
// 루트 배포(Vercel 등)는 미설정 → basePath 없음(기존과 동일).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig = {
  reactStrictMode: true,
  // BFF (`app/api/cgr/[...path]/route.ts`) 가 백엔드로 직접 fetch 하므로 rewrites 불필요.
  // 환경 변수: NEXT_PUBLIC_API_BASE, CGR_API_KEY 는 BFF 안에서 사용.
  ...(basePath ? { basePath } : {}),
  // ─── 보안 응답 헤더 (OWASP A05 / 국정원 점검: 클릭재킹·MIME 스니핑 등) ───
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          // 스크립트/스타일은 제한하지 않고 프레이밍만 차단(앱 동작 영향 없음)
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
