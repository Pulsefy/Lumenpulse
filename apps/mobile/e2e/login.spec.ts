import { test, expect } from '@playwright/test';
import { mockAll } from './mocks';

test.describe('Login', () => {
  test.beforeEach(async ({ page }) => {
    await mockAll(page);
  });

  test('signing in with valid credentials navigates away from the login screen', async ({
    page,
  }) => {
    await page.goto('/auth/login');
    await expect(page.getByTestId('login-email-input')).toBeVisible();

    await page.getByTestId('login-email-input').fill('e2e@lumenpulse.test');
    await page.getByTestId('login-password-input').fill('e2e-password');
    await page.getByTestId('login-submit-button').click();

    // login.tsx calls router.replace('/') on success -- the login form
    // should no longer be present once that navigation completes.
    await expect(page.getByTestId('login-email-input')).toHaveCount(0, { timeout: 10_000 });
  });
});
