import { expect, test } from '@playwright/test';

test('registers a customer account', async ({ page }) => {
  await page.route(/\/api\/v1\/auth\/register$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        user: {
          id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
          firstName: 'Meiir',
          lastName: 'Orazalin',
          email: 'meiir@example.com',
          createdAt: '2026-07-27T12:00:00.000Z',
        },
      },
      status: 201,
    });
  });

  await page.goto('/register');
  await page.getByLabel('First name').fill('Meiir');
  await page.getByLabel('Last name').fill('Orazalin');
  await page.getByLabel('Email').fill('meiir@example.com');
  await page.getByLabel('Password').fill('example-password');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(
    page.getByText(
      'Your account has been created successfully. Login will be added in the next version.',
    ),
  ).toBeVisible();
});
