import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: '노동법 자율점검 — 취업규칙 검토 AI',
  description:
    '서류를 올리면 위반·누락 항목을 위험도별로 정리하고, 어떻게 시정하면 되는지 법령 근거와 함께 안내합니다.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 사용자의 zoom 제한은 접근성 저해라 풀어둠 (max 5x)
  maximumScale: 5,
  userScalable: true,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard — `<link>` 이 globals.css 의 @import 보다 안정.
            preconnect 로 DNS·TLS 미리 처리 → 첫 페인트 깨짐 방지. */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
