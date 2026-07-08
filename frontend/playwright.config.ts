/**
 * Playwright E2E 스모크 설정.
 *
 * - 로컬: 이미 떠 있는 dev 서버(3000)를 재사용, 없으면 dev 서버 기동.
 * - CI: 프로덕션 빌드 산출물을 `next start` 로 기동 (빌드는 CI 선행 단계에서 완료).
 * - 백엔드 없이 동작 — 테스트가 sessionStorage 에 검토 결과를 시드하므로
 *   API 호출 실패(BFF 502)는 페이지 폴백 경로의 일부로 함께 검증된다.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: process.env.CI ? 'npm run start' : 'npm run dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
