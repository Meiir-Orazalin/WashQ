import { expect, test } from '@playwright/test';

test('shows frontend and validated API health', async ({ page }) => {
  await page.route(/\/api\/v1\/health(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        status: 'ok',
        service: 'washqueue-api',
        timestamp: '2026-07-23T12:00:00.000Z',
      },
      status: 200,
    });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'WashQueue KZ' })).toBeVisible();
  await expect(page.getByText('Frontend ready')).toBeVisible();
  await expect(page.getByText('Available')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  await expect(page.getByRole('link', { name: 'Create account' })).toHaveAttribute(
    'href',
    '/register',
  );
});
