import { test, expect } from '@playwright/test';
import { mockAll, loginViaUi } from './mocks';

test.describe('Tab navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockAll(page);
    await loginViaUi(page);
  });

  test('switching to the Projects tab navigates to the projects screen', async ({ page }) => {
    await page.getByText('Projects', { exact: true }).click();
    await expect(page).toHaveURL(/\/projects/);
  });

  test('switching to the Settings tab navigates to the settings screen', async ({ page }) => {
    await page.getByText('Settings', { exact: true }).click();
    await expect(page).toHaveURL(/\/settings/);
  });
});
