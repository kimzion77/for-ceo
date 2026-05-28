/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // BFF (`app/api/cgr/[...path]/route.ts`) 가 백엔드로 직접 fetch 하므로 rewrites 불필요.
  // 환경 변수: NEXT_PUBLIC_API_BASE, CGR_API_KEY 는 BFF 안에서 사용.
};

export default nextConfig;
