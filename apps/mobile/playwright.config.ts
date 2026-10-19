import { defineConfig, devices } from '@playwright/test';

/**
 * Issue #1402: end-to-end smoke suite, run against the app's Expo web build.
 *
 * Web is the one platform Expo apps can run headlessly in CI without an
 * emulator/simulator, which is what makes this suite runnable on every PR
 * instead of only as a manual/local check.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['junit', { outputFile: 'e2e-results.xml' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:8081',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run web -- --port 8081',
    url: 'http://localhost:8081',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      EXPO_PUBLIC_TESTNET_API_URL: 'http://localhost:9999',
      CI: '1',
    },
  },
});
