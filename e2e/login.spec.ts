import { expect, test } from '@playwright/test';

test('logs in, verifies the current user, and keeps authentication memory-only', async ({
  context,
  page,
}) => {
  const accessToken = 'deterministic-memory-only-access-token';
  let currentUserRequests = 0;

  await page.route(/\/api\/v1\/auth\/login$/, async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: 'meiir@example.com',
      password: 'example-password',
    });

    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'Set-Cookie':
          'washqueue_refresh=opaque-test-cookie; HttpOnly; SameSite=Lax; Path=/api/v1/auth',
      },
      json: {
        user: {
          id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
          firstName: 'Login',
          lastName: 'Response',
          email: 'meiir@example.com',
        },
        accessToken,
        accessTokenExpiresAt: '2026-07-28T12:15:00.000Z',
      },
      status: 200,
    });
  });

  await page.route(/\/api\/v1\/auth\/me$/, async (route) => {
    currentUserRequests += 1;
    expect(route.request().headers().authorization).toBe(`Bearer ${accessToken}`);
    expect(route.request().headers().cookie).toBeUndefined();

    await route.fulfill({
      contentType: 'application/json',
      json: {
        user: {
          id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
          firstName: 'Current',
          lastName: 'Customer',
          email: 'meiir@example.com',
        },
      },
      status: 200,
    });
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill('  MEIIR@EXAMPLE.COM  ');
  await page.locator('#login-password').fill('example-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();
  await expect(page.getByText('Current Customer')).toBeVisible();
  await expect(page.getByText('meiir@example.com')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(accessToken);
  expect(currentUserRequests).toBe(1);

  const refreshCookie = (await context.cookies()).find(
    (cookie) => cookie.name === 'washqueue_refresh',
  );
  expect(refreshCookie).toMatchObject({
    httpOnly: true,
    sameSite: 'Lax',
  });
  const browserStorage = await page.evaluate(() => ({
    localStorage: { ...localStorage },
    sessionStorage: { ...sessionStorage },
  }));
  const serializedStorage = JSON.stringify(browserStorage);
  expect(Object.keys(browserStorage.localStorage)).toHaveLength(0);
  expect(
    Object.keys(browserStorage.sessionStorage).every((key) =>
      key.startsWith('__next_debug_channel:'),
    ),
  ).toBe(true);
  expect(serializedStorage).not.toContain(accessToken);
  expect(serializedStorage).not.toContain('example-password');
  expect(serializedStorage).not.toContain('washqueue_refresh');

  await page.reload();

  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(currentUserRequests).toBe(1);
});
