import { test, expect } from '@playwright/test';
import { mockAll, loginViaUi, MOCK_PROJECT } from './mocks';

test.describe('Project detail', () => {
  test.beforeEach(async ({ page }) => {
    await mockAll(page);
    await loginViaUi(page);
  });

  test('opening a project from the list shows its detail screen', async ({ page }) => {
    await page.goto('/projects');
    await page.getByTestId(`project-card-${MOCK_PROJECT.id}`).click();

    await expect(page).toHaveURL(new RegExp(`/projects/${MOCK_PROJECT.id}`));
    // The project name text is ambiguous here (Expo Router's web stack can
    // keep the list screen mounted, hidden, behind the detail screen) --
    // the Contribute button is unique to the detail screen itself.
    await expect(page.getByTestId('project-contribute-button')).toBeVisible();
  });
});
