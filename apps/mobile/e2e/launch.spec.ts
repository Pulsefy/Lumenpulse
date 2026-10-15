import { test, expect } from '@playwright/test';
import { mockAll } from './mocks';

test.describe('App launch', () => {
  test.beforeEach(async ({ page }) => {
    await mockAll(page);
  });

  test('the app boots and renders without a crash screen', async ({ page }) => {
    await page.goto('/');
    // Either the home tab or the login screen is a valid landing point,
    // depending on auth state -- what matters is the app rendered *something*
    // rather than a white screen or an unhandled error boundary.
    await expect(page.locator('body')).not.toBeEmpty();
    await expect(page).not.toHaveTitle(/error/i);
  });
});
