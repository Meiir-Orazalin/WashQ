import { expect, test } from '@playwright/test';

const user = {
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Current',
  lastName: 'Customer',
  email: 'meiir@example.com',
};

function futureTimestamp() {
  return new Date(Date.now() + 15 * 60_000).toISOString();
}

function apiError(code: string, message: string) {
  return {
    error: { code, message },
    timestamp: new Date().toISOString(),
    path: '/api/v1/auth/refresh',
    requestId: 'browser-test-request',
  };
}

test('logs in and restores the memory-only session once after reload', async ({
  context,
  page,
}) => {
  const loginAccessToken = 'deterministic-login-memory-token';
  const restoredAccessToken = 'deterministic-restored-memory-token';
  let loginCompleted = false;
  let initialRefreshRequests = 0;
  let restorationRefreshRequests = 0;
  let currentUserRequests = 0;
  const restorationOrder: string[] = [];

  await page.route(/\/api\/v1\/auth\/refresh$/, async (route) => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.postData()).toBeNull();
    expect(request.headers().authorization).toBeUndefined();

    if (!loginCompleted) {
      initialRefreshRequests += 1;
      await route.fulfill({
        contentType: 'application/json',
        json: apiError('INVALID_REFRESH_SESSION', 'The refresh session is invalid'),
        status: 401,
      });
      return;
    }

    restorationRefreshRequests += 1;
    restorationOrder.push('refresh');
    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'Set-Cookie':
          'washqueue_refresh=rotated-opaque-cookie; HttpOnly; SameSite=Lax; Path=/api/v1/auth',
      },
      json: {
        accessToken: restoredAccessToken,
        accessTokenExpiresAt: futureTimestamp(),
      },
      status: 200,
    });
  });

  await page.route(/\/api\/v1\/auth\/login$/, async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: 'meiir@example.com',
      password: 'example-password',
    });
    loginCompleted = true;

    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'Set-Cookie':
          'washqueue_refresh=initial-opaque-cookie; HttpOnly; SameSite=Lax; Path=/api/v1/auth',
      },
      json: {
        user: {
          ...user,
          firstName: 'Login',
          lastName: 'Response',
        },
        accessToken: loginAccessToken,
        accessTokenExpiresAt: futureTimestamp(),
      },
      status: 200,
    });
  });

  await page.route(/\/api\/v1\/auth\/me$/, async (route) => {
    currentUserRequests += 1;
    const authorization = route.request().headers().authorization;
    expect([`Bearer ${loginAccessToken}`, `Bearer ${restoredAccessToken}`]).toContain(
      authorization,
    );
    expect(route.request().headers().cookie).toBeUndefined();
    if (authorization === `Bearer ${restoredAccessToken}`) {
      restorationOrder.push('me');
    }

    await route.fulfill({
      contentType: 'application/json',
      json: { user },
      status: 200,
    });
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill('  MEIIR@EXAMPLE.COM  ');
  await page.locator('#login-password').fill('example-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();
  await expect(page.getByText('Current Customer')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(loginAccessToken);
  expect(initialRefreshRequests).toBe(1);
  expect(currentUserRequests).toBe(1);

  await page.reload();

  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();
  await expect(page.getByText('Current Customer')).toBeVisible();
  expect(restorationRefreshRequests).toBe(1);
  expect(restorationOrder).toEqual(['refresh', 'me']);
  expect(currentUserRequests).toBe(2);

  const refreshCookie = (await context.cookies()).find(
    (cookie) => cookie.name === 'washqueue_refresh',
  );
  expect(refreshCookie).toMatchObject({
    httpOnly: true,
    sameSite: 'Lax',
    path: '/api/v1/auth',
    value: 'rotated-opaque-cookie',
  });

  const browserState = await page.evaluate(() => ({
    cookie: document.cookie,
    html: document.documentElement.innerHTML,
    localStorage: { ...localStorage },
    sessionStorage: { ...sessionStorage },
  }));
  expect(browserState.cookie).not.toContain('washqueue_refresh');
  expect(Object.keys(browserState.localStorage)).toHaveLength(0);
  expect(
    Object.keys(browserState.sessionStorage).every((key) =>
      key.startsWith('__next_debug_channel:'),
    ),
  ).toBe(true);
  const serializedState = JSON.stringify(browserState);
  expect(serializedState).not.toContain(loginAccessToken);
  expect(serializedState).not.toContain(restoredAccessToken);
  expect(serializedState).not.toContain('example-password');
  expect(serializedState).not.toContain('rotated-opaque-cookie');
});

test('settles an invalid startup session without a refresh loop', async ({ page }) => {
  let refreshRequests = 0;

  await page.route(/\/api\/v1\/auth\/refresh$/, async (route) => {
    refreshRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      json: apiError('INVALID_REFRESH_SESSION', 'The refresh session is invalid'),
      status: 401,
    });
  });

  await page.goto('/login');

  await expect(page.getByLabel('Email')).toBeVisible();
  await page.waitForTimeout(200);
  expect(refreshRequests).toBe(1);
  await expect(page.getByText('Restoring your session…')).not.toBeVisible();
});
