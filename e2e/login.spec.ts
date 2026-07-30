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

test('logs out once, clears the cookie, and remains unauthenticated after reload', async ({
  context,
  page,
}) => {
  let authenticated = false;
  let logoutRequests = 0;
  let refreshRequests = 0;
  let currentUserRequests = 0;

  await page.route(/\/api\/v1\/auth\/refresh$/, async (route) => {
    refreshRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'Set-Cookie': 'washqueue_refresh=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/api/v1/auth',
      },
      json: apiError('INVALID_REFRESH_SESSION', 'The refresh session is invalid'),
      status: 401,
    });
  });
  await page.route(/\/api\/v1\/auth\/login$/, async (route) => {
    authenticated = true;
    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'Set-Cookie':
          'washqueue_refresh=logout-test-cookie; HttpOnly; SameSite=Lax; Path=/api/v1/auth',
      },
      json: {
        user,
        accessToken: 'logout-test-access-token',
        accessTokenExpiresAt: futureTimestamp(),
      },
      status: 200,
    });
  });
  await page.route(/\/api\/v1\/auth\/me$/, async (route) => {
    currentUserRequests += 1;
    await route.fulfill({ contentType: 'application/json', json: { user }, status: 200 });
  });
  await page.route(/\/api\/v1\/auth\/logout$/, async (route) => {
    logoutRequests += 1;
    authenticated = false;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postData()).toBeNull();
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({
      body: '',
      headers: {
        'Set-Cookie': 'washqueue_refresh=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/api/v1/auth',
      },
      status: 204,
    });
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.locator('#login-password').fill('example-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page.getByLabel('Email')).toBeVisible();
  expect(logoutRequests).toBe(1);
  expect(authenticated).toBe(false);
  expect((await context.cookies()).some((cookie) => cookie.name === 'washqueue_refresh')).toBe(
    false,
  );
  const meRequestsBeforeReload = currentUserRequests;

  await page.reload();
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.waitForTimeout(200);

  expect(logoutRequests).toBe(1);
  expect(refreshRequests).toBe(2);
  expect(currentUserRequests).toBe(meRequestsBeforeReload);
});

test('waits for an in-flight refresh before logout and ignores the stale token result', async ({
  page,
}) => {
  let loggedIn = false;
  let releaseRefresh: (() => void) | undefined;
  let signalRefreshStarted: (() => void) | undefined;
  const refreshStarted = new Promise<void>((resolve) => {
    signalRefreshStarted = resolve;
  });
  const refreshRelease = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  const requestOrder: string[] = [];
  let logoutRequests = 0;

  await page.route(/\/api\/v1\/auth\/refresh$/, async (route) => {
    if (!loggedIn) {
      await route.fulfill({
        contentType: 'application/json',
        json: apiError('INVALID_REFRESH_SESSION', 'The refresh session is invalid'),
        status: 401,
      });
      return;
    }

    requestOrder.push('refresh-start');
    signalRefreshStarted?.();
    await refreshRelease;
    requestOrder.push('refresh-settle');
    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'Set-Cookie': 'washqueue_refresh=newest-cookie; HttpOnly; SameSite=Lax; Path=/api/v1/auth',
      },
      json: {
        accessToken: 'late-refresh-access-token',
        accessTokenExpiresAt: futureTimestamp(),
      },
      status: 200,
    });
  });
  await page.route(/\/api\/v1\/auth\/login$/, async (route) => {
    loggedIn = true;
    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'Set-Cookie':
          'washqueue_refresh=pre-refresh-cookie; HttpOnly; SameSite=Lax; Path=/api/v1/auth',
      },
      json: {
        user,
        accessToken: 'short-lived-access-token',
        accessTokenExpiresAt: new Date(Date.now() + 61_000).toISOString(),
      },
      status: 200,
    });
  });
  await page.route(/\/api\/v1\/auth\/me$/, async (route) => {
    await route.fulfill({ contentType: 'application/json', json: { user }, status: 200 });
  });
  await page.route(/\/api\/v1\/auth\/logout$/, async (route) => {
    logoutRequests += 1;
    requestOrder.push('logout');
    await route.fulfill({
      body: '',
      headers: {
        'Set-Cookie': 'washqueue_refresh=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/api/v1/auth',
      },
      status: 204,
    });
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.locator('#login-password').fill('example-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();
  await refreshStarted;

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Clearing your session…' })).toBeVisible();
  expect(logoutRequests).toBe(0);

  releaseRefresh?.();
  await expect(page.getByLabel('Email')).toBeVisible();

  expect(logoutRequests).toBe(1);
  expect(requestOrder).toEqual(['refresh-start', 'refresh-settle', 'logout']);
  await expect(page.locator('body')).not.toContainText('late-refresh-access-token');
});

test('keeps local state cleared after an unconfirmed logout and retries only on request', async ({
  page,
}) => {
  let loggedIn = false;
  let logoutRequests = 0;
  let refreshRequests = 0;

  await page.route(/\/api\/v1\/auth\/refresh$/, async (route) => {
    refreshRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      json: apiError('INVALID_REFRESH_SESSION', 'The refresh session is invalid'),
      status: 401,
    });
  });
  await page.route(/\/api\/v1\/auth\/login$/, async (route) => {
    loggedIn = true;
    await route.fulfill({
      contentType: 'application/json',
      json: {
        user,
        accessToken: 'logout-failure-access-token',
        accessTokenExpiresAt: futureTimestamp(),
      },
      status: 200,
    });
  });
  await page.route(/\/api\/v1\/auth\/me$/, async (route) => {
    await route.fulfill({ contentType: 'application/json', json: { user }, status: 200 });
  });
  await page.route(/\/api\/v1\/auth\/logout$/, async (route) => {
    logoutRequests += 1;
    if (logoutRequests === 1) {
      await route.fulfill({
        contentType: 'application/json',
        json: apiError('INTERNAL_SERVER_ERROR', 'An unexpected error occurred'),
        status: 500,
      });
      return;
    }

    loggedIn = false;
    await route.fulfill({ body: '', status: 204 });
  });

  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.locator('#login-password').fill('example-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page.getByRole('heading', { name: 'Please retry sign-out' })).toBeVisible();
  await page.waitForTimeout(200);
  expect(logoutRequests).toBe(1);
  expect(refreshRequests).toBe(1);
  await expect(page.locator('body')).not.toContainText('logout-failure-access-token');

  await page.getByRole('button', { name: 'Retry sign out' }).click();
  await expect(page.getByLabel('Email')).toBeVisible();
  expect(logoutRequests).toBe(2);
  expect(refreshRequests).toBe(1);
  expect(loggedIn).toBe(false);
});
