import { test, expect } from '@playwright/test';
import { mockAll, loginViaUi, MOCK_PROJECT } from './mocks';

test.describe('Contribution modal', () => {
  test.beforeEach(async ({ page }) => {
    await mockAll(page);
    await loginViaUi(page);
  });

  test('opening the contribute button shows the contribution modal with an amount field', async ({
    page,
  }) => {
    await page.goto(`/projects/${MOCK_PROJECT.id}`);
    await page.getByTestId('project-contribute-button').click();

    await expect(page.getByTestId('contribution-amount-input')).toBeVisible();
  });
});
