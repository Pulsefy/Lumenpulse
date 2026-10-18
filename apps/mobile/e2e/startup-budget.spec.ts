import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, devices } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockAll } from './mocks';

const MEASUREMENTS_FILE = path.join(__dirname, '..', 'mobile-startup-measurements.json');

test.use({
  ...devices['Pixel 5'],
});

async function applyLowEndProfile(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: (1.5 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    latency: 150,
  });
}

async function navigationReadyMs(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav && nav.domContentLoadedEventEnd > 0) {
      return Math.round(nav.domContentLoadedEventEnd - nav.startTime);
    }
    return Math.round(performance.now());
  });
}

async function waitForAppInteractive(page: Page): Promise<void> {
  // Marker view is intentionally 0×0 (not user-visible); Playwright treats it as hidden.
  await page.waitForFunction(
    () => {
      const boot = (globalThis as { __LUMENPULSE_STARTUP__?: { timeToInteractiveMs: number | null } })
        .__LUMENPULSE_STARTUP__;
      return boot?.timeToInteractiveMs != null;
    },
    { timeout: 20_000 },
  );
  await expect(page.getByTestId('app-interactive')).toBeAttached();
}

async function timeToInteractiveMs(page: Page): Promise<number> {
  await waitForAppInteractive(page);
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const boot = (
      globalThis as {
        __LUMENPULSE_STARTUP__?: {
          timeToInteractiveMs: number | null;
          phases?: { timeToInteractive?: number };
        };
      }
    ).__LUMENPULSE_STARTUP__;
    const ttiWall = boot?.phases?.timeToInteractive;
    if (nav && ttiWall != null) {
      const navigationStartWall = performance.timeOrigin + nav.startTime;
      return Math.round(ttiWall - navigationStartWall);
    }
    if (nav && nav.domContentLoadedEventEnd > 0) {
      return Math.round(nav.domContentLoadedEventEnd - nav.startTime);
    }
    return boot?.timeToInteractiveMs ?? Math.round(performance.now());
  });
}

test.describe('Startup budget (low-end profile)', () => {
  test.beforeEach(async ({ page }) => {
    await mockAll(page);
    await applyLowEndProfile(page);
  });

  test('records cold, warm, and time-to-interactive baselines', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const coldStartMs = await navigationReadyMs(page);
    const timeToInteractiveMsValue = await timeToInteractiveMs(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const warmStartMs = await navigationReadyMs(page);
    await waitForAppInteractive(page);

    const payload = {
      profile: 'low-end-web',
      recordedAt: new Date().toISOString(),
      metrics: {
        coldStartMs,
        warmStartMs,
        timeToInteractiveMs: timeToInteractiveMsValue,
      },
    };

    writeFileSync(MEASUREMENTS_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    expect(coldStartMs).toBeGreaterThan(0);
    expect(warmStartMs).toBeGreaterThan(0);
    expect(timeToInteractiveMsValue).toBeGreaterThan(0);
  });
});
