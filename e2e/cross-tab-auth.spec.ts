import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

const refreshCookieName = 'washqueue_refresh';
const refreshCookiePath = '/api/v1/auth';
const user = {
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Cross-tab',
  lastName: 'Customer',
  email: 'cross-tab@example.com',
};

function futureTimestamp(milliseconds = 15 * 60_000) {
  return new Date(Date.now() + milliseconds).toISOString();
}

async function setRefreshCookie(context: BrowserContext, value: string) {
  await context.addCookies([
    {
      name: refreshCookieName,
      value,
      domain: '127.0.0.1',
      path: refreshCookiePath,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

async function expectAuthenticated(page: Page) {
  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();
  await expect(page.getByText('Cross-tab Customer')).toBeVisible();
}

function fulfillCurrentUser(route: Route) {
  return route.fulfill({
    contentType: 'application/json',
    json: { user },
    status: 200,
  });
}

test('@cross-tab serializes simultaneous restoration and repeated rotations', async ({
  context,
}) => {
  let currentCookie = 'cross-tab-cookie-0';
  let rotation = 0;
  let activeMutations = 0;
  let maximumConcurrentMutations = 0;
  const responseStatuses: number[] = [];
  const pages = [await context.newPage(), await context.newPage()];

  await setRefreshCookie(context, currentCookie);
  await context.route(/\/api\/v1\/auth\/refresh$/, async (route) => {
    activeMutations += 1;
    maximumConcurrentMutations = Math.max(maximumConcurrentMutations, activeMutations);
    await new Promise((resolve) => setTimeout(resolve, 35));

    rotation += 1;
    currentCookie = `cross-tab-cookie-${rotation}`;
    responseStatuses.push(200);
    activeMutations -= 1;
    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'Set-Cookie': `${refreshCookieName}=${currentCookie}; HttpOnly; SameSite=Lax; Path=${refreshCookiePath}`,
      },
      json: {
        accessToken: `cross-tab-access-${rotation}`,
        accessTokenExpiresAt: futureTimestamp(),
      },
      status: 200,
    });
  });
  await context.route(/\/api\/v1\/auth\/me$/, fulfillCurrentUser);

  await Promise.all(pages.map((page) => page.goto('/login')));
  await Promise.all(pages.map(expectAuthenticated));

  for (let cycle = 0; cycle < 5; cycle += 1) {
    await Promise.all(pages.map((page) => page.reload()));
    await Promise.all(pages.map(expectAuthenticated));
  }

  const followUp = await context.newPage();
  await followUp.goto('/login');
  await expectAuthenticated(followUp);

  expect(maximumConcurrentMutations).toBe(1);
  expect(responseStatuses).toHaveLength(13);
  expect(responseStatuses.every((status) => status === 200)).toBe(true);
  const finalCookie = (await context.cookies()).find((cookie) => cookie.name === refreshCookieName);
  expect(finalCookie?.value).toBe('cross-tab-cookie-13');
  expect(finalCookie).toMatchObject({
    httpOnly: true,
    sameSite: 'Lax',
    path: refreshCookiePath,
  });
});

test('@cross-tab serializes near-expiration refreshes from two tabs', async ({ context }) => {
  let currentCookie = 'near-expiration-cookie-0';
  let rotation = 0;
  let activeMutations = 0;
  let maximumConcurrentMutations = 0;
  const pages = [await context.newPage(), await context.newPage()];

  await setRefreshCookie(context, currentCookie);
  await context.route(/\/api\/v1\/auth\/refresh$/, async (route) => {
    activeMutations += 1;
    maximumConcurrentMutations = Math.max(maximumConcurrentMutations, activeMutations);
    await new Promise((resolve) => setTimeout(resolve, 35));

    rotation += 1;
    currentCookie = `near-expiration-cookie-${rotation}`;
    activeMutations -= 1;
    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'Set-Cookie': `${refreshCookieName}=${currentCookie}; HttpOnly; SameSite=Lax; Path=${refreshCookiePath}`,
      },
      json: {
        accessToken: `near-expiration-access-${rotation}`,
        accessTokenExpiresAt: futureTimestamp(rotation <= 2 ? 60_500 : 15 * 60_000),
      },
      status: 200,
    });
  });
  await context.route(/\/api\/v1\/auth\/me$/, fulfillCurrentUser);

  await Promise.all(pages.map((page) => page.goto('/login')));
  await Promise.all(pages.map(expectAuthenticated));

  await expect.poll(() => rotation, { timeout: 5_000 }).toBe(4);
  await Promise.all(pages.map(expectAuthenticated));

  expect(maximumConcurrentMutations).toBe(1);
  expect((await context.cookies()).find((cookie) => cookie.name === refreshCookieName)?.value).toBe(
    'near-expiration-cookie-4',
  );
});

test('@cross-tab orders refresh before logout and sends the newest cookie', async ({
  browserName,
  context,
}) => {
  let currentCookie = 'refresh-logout-cookie-0';
  let rotation = 0;
  let refreshCanSettle: (() => void) | undefined;
  let signalRefreshStarted: (() => void) | undefined;
  const refreshStarted = new Promise<void>((resolve) => {
    signalRefreshStarted = resolve;
  });
  const releaseRefresh = new Promise<void>((resolve) => {
    refreshCanSettle = resolve;
  });
  const order: string[] = [];
  const refreshPage = await context.newPage();
  const logoutPage = await context.newPage();
  const pages = [refreshPage, logoutPage];

  await setRefreshCookie(context, currentCookie);
  await context.route(/\/api\/v1\/auth\/refresh$/, async (route) => {
    rotation += 1;
    if (rotation === 3) {
      order.push('refresh-start');
      signalRefreshStarted?.();
      await releaseRefresh;
    }

    currentCookie = `refresh-logout-cookie-${rotation}`;
    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'Set-Cookie': `${refreshCookieName}=${currentCookie}; HttpOnly; SameSite=Lax; Path=${refreshCookiePath}`,
      },
      json: {
        accessToken: `refresh-logout-access-${rotation}`,
        accessTokenExpiresAt: futureTimestamp(),
      },
      status: 200,
    });
    if (rotation === 3) {
      order.push('refresh-settle');
    }
  });
  await context.route(/\/api\/v1\/auth\/me$/, fulfillCurrentUser);
  await context.route(/\/api\/v1\/auth\/logout$/, async (route) => {
    order.push('logout-start');
    currentCookie = '';
    await route.fulfill({
      body: '',
      headers: {
        'Set-Cookie': `${refreshCookieName}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax; Path=${refreshCookiePath}`,
      },
      status: 204,
    });
  });

  await Promise.all(pages.map((page) => page.goto('/login')));
  await Promise.all(pages.map(expectAuthenticated));

  const refreshPageReload = refreshPage.reload();
  await refreshStarted;
  await logoutPage.getByRole('button', { name: 'Sign out' }).click();
  await expect(logoutPage.getByRole('heading', { name: 'Clearing your session…' })).toBeVisible();
  expect(order).toEqual(['refresh-start']);

  refreshCanSettle?.();
  await refreshPageReload;
  await expectAuthenticated(refreshPage);
  await expect(logoutPage.getByLabel('Email')).toBeVisible();

  expect(order).toEqual(['refresh-start', 'refresh-settle', 'logout-start']);
  // Playwright WebKit does not apply an intercepted 204 Set-Cookie deletion to its
  // cookie jar; the built-API browser review covers that transport behavior.
  if (browserName !== 'webkit') {
    expect((await context.cookies()).some((cookie) => cookie.name === refreshCookieName)).toBe(
      false,
    );
  }
  await expectAuthenticated(refreshPage);
});

test('@cross-tab orders explicit login after a refresh and keeps the login state current', async ({
  context,
}) => {
  let currentCookie = 'login-refresh-cookie-0';
  let refreshCanSettle: (() => void) | undefined;
  let signalRefreshStarted: (() => void) | undefined;
  const refreshStarted = new Promise<void>((resolve) => {
    signalRefreshStarted = resolve;
  });
  const releaseRefresh = new Promise<void>((resolve) => {
    refreshCanSettle = resolve;
  });
  const order: string[] = [];
  const loginPage = await context.newPage();
  const refreshPage = await context.newPage();

  await context.route(/\/api\/v1\/auth\/refresh$/, async (route) => {
    const hasRefreshCookie = (await context.cookies()).some(
      (cookie) => cookie.name === refreshCookieName,
    );
    if (!hasRefreshCookie) {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          error: {
            code: 'INVALID_REFRESH_SESSION',
            message: 'The refresh session is invalid',
          },
          timestamp: new Date().toISOString(),
          path: '/api/v1/auth/refresh',
          requestId: 'cross-tab-test',
        },
        status: 401,
      });
      return;
    }

    order.push('refresh-start');
    signalRefreshStarted?.();
    await releaseRefresh;
    currentCookie = 'login-refresh-cookie-1';
    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'Set-Cookie': `${refreshCookieName}=${currentCookie}; HttpOnly; SameSite=Lax; Path=${refreshCookiePath}`,
      },
      json: {
        accessToken: 'pre-login-refreshed-access',
        accessTokenExpiresAt: futureTimestamp(),
      },
      status: 200,
    });
    order.push('refresh-settle');
  });
  await context.route(/\/api\/v1\/auth\/login$/, async (route) => {
    order.push('login-start');
    currentCookie = 'explicit-login-cookie';
    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'Set-Cookie': `${refreshCookieName}=${currentCookie}; HttpOnly; SameSite=Lax; Path=${refreshCookiePath}`,
      },
      json: {
        user,
        accessToken: 'explicit-login-access',
        accessTokenExpiresAt: futureTimestamp(),
      },
      status: 200,
    });
    order.push('login-settle');
  });
  await context.route(/\/api\/v1\/auth\/me$/, fulfillCurrentUser);

  await loginPage.goto('/login');
  await expect(loginPage.getByLabel('Email')).toBeVisible();
  await setRefreshCookie(context, currentCookie);

  const refreshNavigation = refreshPage.goto('/login');
  await refreshStarted;
  await loginPage.getByLabel('Email').fill(user.email);
  await loginPage.locator('#login-password').fill('example-password');
  await loginPage.getByRole('button', { name: 'Sign in' }).click();
  expect(order).toEqual(['refresh-start']);

  refreshCanSettle?.();
  await refreshNavigation;
  await Promise.all([expectAuthenticated(refreshPage), expectAuthenticated(loginPage)]);

  expect(order).toEqual(['refresh-start', 'refresh-settle', 'login-start', 'login-settle']);
  expect((await context.cookies()).find((cookie) => cookie.name === refreshCookieName)?.value).toBe(
    'explicit-login-cookie',
  );
});

test('@cross-tab fails closed without Web Locks and sends no cookie mutation', async ({
  context,
  page,
}) => {
  let mutationRequests = 0;
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });
  });
  await context.route(/\/api\/v1\/auth\/(login|refresh|logout)$/, async (route) => {
    mutationRequests += 1;
    await route.abort();
  });

  await page.goto('/login');

  await expect(
    page.getByRole('heading', { name: 'We could not safely coordinate your session' }),
  ).toBeVisible();
  expect(mutationRequests).toBe(0);
  await page.getByRole('button', { name: 'Continue to sign in' }).click();
  await page.getByLabel('Email').fill(user.email);
  await page.locator('#login-password').fill('example-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByRole('heading', { name: 'We could not safely coordinate your session' }),
  ).toBeVisible();
  expect(mutationRequests).toBe(0);
});
