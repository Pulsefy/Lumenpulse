import type { Page } from '@playwright/test';

/**
 * Issue #1402: shared network stubs for the E2E smoke suite.
 *
 * The suite runs against the Expo web build with EXPO_PUBLIC_TESTNET_API_URL
 * pointed at an address nothing is listening on (see playwright.config.ts) --
 * every request is intercepted here before it ever leaves the browser, so no
 * live backend is required.
 */
export const API_BASE = 'http://localhost:9999';

export const MOCK_PROJECT = {
  id: 1,
  owner: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV',
  name: 'Lumenpulse Test Project',
  description: 'A project seeded for the E2E smoke suite.',
  targetAmount: '10000.0000000',
  tokenAddress: 'CABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV',
  totalDeposited: '2500.0000000',
  totalWithdrawn: '0.0000000',
  isActive: true,
  onChainStatus: 'ACTIVE',
  contributorCount: 12,
  createdAt: '2026-01-01T00:00:00.000Z',
};

export async function mockAuth(page: Page): Promise<void> {
  await page.route(`${API_BASE}/auth/login`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'e2e-access-token',
        refresh_token: 'e2e-refresh-token',
      }),
    });
  });
}

export async function mockProjects(page: Page): Promise<void> {
  await page.route(`${API_BASE}/crowdfund/projects`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([MOCK_PROJECT]),
    });
  });

  await page.route(`${API_BASE}/crowdfund/projects/${MOCK_PROJECT.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PROJECT),
    });
  });

  await page.route(
    `${API_BASE}/crowdfund/projects/${MOCK_PROJECT.id}/contributors`,
    async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    },
  );

  await page.route(
    `${API_BASE}/crowdfund/projects/${MOCK_PROJECT.id}/my-contributions`,
    async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    },
  );
}

export async function mockContribute(page: Page): Promise<void> {
  await page.route(`${API_BASE}/crowdfund/contribute`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ transactionId: 'e2e-tx-hash', status: 'success' }),
    });
  });
}

export async function mockExports(page: Page): Promise<void> {
  const mockJob = {
    id: 'e2e-export-job-1',
    type: 'tax_transactions',
    status: 'completed',
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:01:00.000Z',
  };

  await page.route(`${API_BASE}/exports`, async (route) => {
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON() || {};
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          ...mockJob,
          type: data.type || 'tax_transactions',
          status: 'pending',
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([mockJob]),
    });
  });

  await page.route(`${API_BASE}/exports/${mockJob.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockJob),
    });
  });

  await page.route(`${API_BASE}/exports/${mockJob.id}/download`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/csv',
      body: 'id,date,amount\n1,2026-09-28,100',
    });
  });
}

/** Catch-all so any endpoint the suite doesn't explicitly care about degrades gracefully. */
export async function mockRemaining(page: Page): Promise<void> {
  await page.route(`${API_BASE}/**`, async (route) => {
    // Most unhandled endpoints here are list/collection reads (notifications,
    // linked accounts, portfolio history, etc.) -- an empty array is a safer
    // generic default than {} since several contexts call .filter()/.map()
    // on the response without a defensive Array.isArray() check first.
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
}

/** Drive the real login screen (not a storage shortcut) so the login flow itself stays covered. */
export async function loginViaUi(page: Page): Promise<void> {
  await page.goto('/auth/login');
  await page.getByTestId('login-email-input').fill('e2e@lumenpulse.test');
  await page.getByTestId('login-password-input').fill('e2e-password');
  await page.getByTestId('login-submit-button').click();
}

export async function mockAll(page: Page): Promise<void> {
  // Playwright matches the most-recently-registered route first, so the
  // catch-all must be registered before the specific routes it should defer to.
  await mockRemaining(page);
  await mockAuth(page);
  await mockProjects(page);
  await mockContribute(page);
  await mockExports(page);
}
