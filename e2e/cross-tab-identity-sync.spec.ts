import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
  type Route,
} from '@playwright/test';

const refreshCookieName = 'washqueue_refresh';
const refreshCookiePath = '/api/v1/auth';
const lifecycleChannelName = 'washqueue-auth-events-v1';
const password = 'example-password';

const userA = {
  id: 'ac282b04-0fac-4c8d-a7ba-5c64bca4d031',
  firstName: 'Account',
  lastName: 'Alpha',
  email: 'alpha@example.com',
};
const userB = {
  id: 'f6656861-d6df-41bd-9e88-bb16b7ce1e07',
  firstName: 'Account',
  lastName: 'Beta',
  email: 'beta@example.com',
};
type TestUser = typeof userA;

function futureTimestamp() {
  return new Date(Date.now() + 15 * 60_000).toISOString();
}

function apiError(code: string, message: string) {
  return {
    error: { code, message },
    timestamp: new Date().toISOString(),
    path: '/api/v1/auth/refresh',
    requestId: 'cross-tab-identity-test',
  };
}

async function instrumentLifecycleEvents(context: BrowserContext) {
  await context.addInitScript(
    ({ channelName }) => {
      const eventWindow = window as Window & { __washqueueLifecycleEvents?: unknown[] };
      eventWindow.__washqueueLifecycleEvents = [];
      const NativeBroadcastChannel = window.BroadcastChannel;
      const capturedChannels = new WeakSet<BroadcastChannel>();

      class InstrumentedBroadcastChannel extends NativeBroadcastChannel {
        constructor(name: string) {
          super(name);
          if (name === channelName) {
            capturedChannels.add(this);
          }
        }

        override postMessage(message: unknown) {
          if (capturedChannels.has(this)) {
            eventWindow.__washqueueLifecycleEvents?.push(message);
          }
          super.postMessage(message);
        }
      }

      Object.defineProperty(window, 'BroadcastChannel', {
        configurable: true,
        value: InstrumentedBroadcastChannel,
      });
    },
    { channelName: lifecycleChannelName },
  );
}

class AuthHarness {
  currentUser: TestUser | null = null;
  activeMutations = 0;
  maximumConcurrentMutations = 0;
  refreshRequests = 0;
  logoutRequests = 0;
  replayRevocations = 0;
  readonly issuedTokens: string[] = [];
  readonly requestOrder: { operation: 'login' | 'refresh' | 'me' | 'logout'; page: string }[] = [];
  readonly meSubjects: { page: string; userId: string }[] = [];
  private readonly tokenUsers = new Map<string, TestUser>();
  private readonly pageNames = new Map<Page, string>();
  private rotation = 0;
  private blockedRefresh:
    | {
        page: Page;
        release: Promise<void>;
        signalStarted: () => void;
      }
    | undefined;

  namePages(pages: readonly Page[]) {
    pages.forEach((page, index) => this.pageNames.set(page, `page-${index + 1}`));
  }

  blockNextRefresh(page: Page) {
    let releaseRefresh: (() => void) | undefined;
    let signalStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    this.blockedRefresh = {
      page,
      release,
      signalStarted: () => signalStarted?.(),
    };
    return {
      started,
      release: () => releaseRefresh?.(),
    };
  }

  async install(context: BrowserContext) {
    await context.route(/\/api\/v1\/auth\/login$/, (route) => this.login(route));
    await context.route(/\/api\/v1\/auth\/refresh$/, (route) => this.refresh(route));
    await context.route(/\/api\/v1\/auth\/me$/, (route) => this.me(route));
    await context.route(/\/api\/v1\/auth\/logout$/, (route) => this.logout(route));
  }

  private pageName(request: Request) {
    return this.pageNames.get(request.frame().page()) ?? 'unnamed-page';
  }

  private issueToken(user: TestUser, prefix: string) {
    this.rotation += 1;
    const token = `${prefix}-memory-token-${this.rotation}`;
    this.issuedTokens.push(token);
    this.tokenUsers.set(token, user);
    return token;
  }

  private async withCookieMutation(operation: () => Promise<void>) {
    this.activeMutations += 1;
    this.maximumConcurrentMutations = Math.max(
      this.maximumConcurrentMutations,
      this.activeMutations,
    );
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await operation();
    } finally {
      this.activeMutations -= 1;
    }
  }

  private async login(route: Route) {
    await this.withCookieMutation(async () => {
      this.requestOrder.push({ operation: 'login', page: this.pageName(route.request()) });
      const request: unknown = route.request().postDataJSON();
      const email =
        typeof request === 'object' && request !== null && 'email' in request
          ? String(request.email)
          : '';
      const user = email === userB.email ? userB : userA;
      this.currentUser = user;
      const accessToken = this.issueToken(user, 'login');
      await route.fulfill({
        contentType: 'application/json',
        headers: {
          'Set-Cookie': `${refreshCookieName}=login-cookie-${this.rotation}; HttpOnly; SameSite=Lax; Path=${refreshCookiePath}`,
        },
        json: {
          user,
          accessToken,
          accessTokenExpiresAt: futureTimestamp(),
        },
        status: 200,
      });
    });
  }

  private async refresh(route: Route) {
    await this.withCookieMutation(async () => {
      this.refreshRequests += 1;
      this.requestOrder.push({ operation: 'refresh', page: this.pageName(route.request()) });
      if (!this.currentUser) {
        await route.fulfill({
          contentType: 'application/json',
          headers: {
            'Set-Cookie': `${refreshCookieName}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=${refreshCookiePath}`,
          },
          json: apiError('INVALID_REFRESH_SESSION', 'The refresh session is invalid'),
          status: 401,
        });
        return;
      }

      const blockedRefresh = this.blockedRefresh;
      if (blockedRefresh?.page === route.request().frame().page()) {
        this.blockedRefresh = undefined;
        blockedRefresh.signalStarted();
        await blockedRefresh.release;
      }

      const user = this.currentUser;
      const accessToken = this.issueToken(user, 'refresh');
      await route.fulfill({
        contentType: 'application/json',
        headers: {
          'Set-Cookie': `${refreshCookieName}=rotated-cookie-${this.rotation}; HttpOnly; SameSite=Lax; Path=${refreshCookiePath}`,
        },
        json: {
          accessToken,
          accessTokenExpiresAt: futureTimestamp(),
        },
        status: 200,
      });
    });
  }

  private async me(route: Route) {
    const page = this.pageName(route.request());
    this.requestOrder.push({ operation: 'me', page });
    const authorization = route.request().headers().authorization ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const user = this.tokenUsers.get(token);
    if (!user) {
      await route.fulfill({
        contentType: 'application/json',
        json: apiError('AUTHENTICATION_REQUIRED', 'Authentication is required'),
        status: 401,
      });
      return;
    }

    this.meSubjects.push({ page, userId: user.id });
    await route.fulfill({ contentType: 'application/json', json: { user }, status: 200 });
  }

  private async logout(route: Route) {
    await this.withCookieMutation(async () => {
      this.logoutRequests += 1;
      this.requestOrder.push({ operation: 'logout', page: this.pageName(route.request()) });
      this.currentUser = null;
      await route.fulfill({
        body: '',
        headers: {
          'Set-Cookie': `${refreshCookieName}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=${refreshCookiePath}`,
        },
        status: 204,
      });
    });
  }
}

async function openUnauthenticatedPages(
  context: BrowserContext,
  harness: AuthHarness,
  count: number,
) {
  const pages = await Promise.all(Array.from({ length: count }, async () => context.newPage()));
  harness.namePages(pages);
  await harness.install(context);
  await Promise.all(pages.map((page) => page.goto('/login')));
  await Promise.all(pages.map((page) => expect(page.getByLabel('Email')).toBeVisible()));
  return pages;
}

async function login(page: Page, user: TestUser) {
  await page.getByLabel('Email').fill(user.email);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function expectUser(page: Page, user: TestUser) {
  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();
  await expect(page.getByText(`${user.firstName} ${user.lastName}`)).toBeVisible();
  await expect(page.getByText(user.email)).toBeVisible();
}

async function lifecycleEvents(page: Page) {
  return page.evaluate(() => {
    const eventWindow = window as Window & { __washqueueLifecycleEvents?: unknown[] };
    return eventWindow.__washqueueLifecycleEvents ?? [];
  });
}

async function expectNoCredentialPersistence(
  pages: readonly Page[],
  issuedTokens: readonly string[],
) {
  for (const page of pages) {
    const browserState = await page.evaluate(async () => ({
      cookie: document.cookie,
      html: document.documentElement.innerHTML,
      indexedDb: indexedDB.databases ? await indexedDB.databases() : [],
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
    }));
    const serialized = JSON.stringify(browserState);
    for (const token of issuedTokens) {
      expect(serialized).not.toContain(token);
    }
    expect(serialized).not.toContain(password);
  }
}

function firstTwoPages(pages: readonly Page[]): [Page, Page] {
  const first = pages.at(0);
  const second = pages.at(1);
  if (!first || !second) {
    throw new Error('The cross-tab test requires two pages');
  }
  return [first, second];
}

function expectSafeLifecyclePayloads(events: readonly unknown[]) {
  for (const event of events) {
    expect(event).toEqual({
      type: expect.stringMatching(/^(session-changed|logout)$/),
      sourceId: expect.any(String),
    });
    expect(Object.keys(event as Record<string, unknown>).sort()).toEqual(['sourceId', 'type']);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toMatch(
      /access.?token|refresh.?token|cookie|email|password|user.?id|session.?id|family.?id|first.?name|last.?name/i,
    );
    expect(serialized).not.toContain(userA.id);
    expect(serialized).not.toContain(userB.id);
  }
}

test('@cross-tab-identity synchronizes a same-user login through refresh plus /me', async ({
  context,
}) => {
  await instrumentLifecycleEvents(context);
  const harness = new AuthHarness();
  const pages = await openUnauthenticatedPages(context, harness, 2);
  const [primaryPage] = firstTwoPages(pages);

  await login(primaryPage, userA);
  await Promise.all(pages.map((page) => expectUser(page, userA)));

  const events = (await Promise.all(pages.map(lifecycleEvents))).flat();
  expect(events).toHaveLength(1);
  expectSafeLifecyclePayloads(events);
  expect(harness.meSubjects.filter(({ userId }) => userId === userA.id)).toHaveLength(2);
  expect(harness.requestOrder.slice(-2)).toEqual([
    { operation: 'refresh', page: 'page-2' },
    { operation: 'me', page: 'page-2' },
  ]);
  expect(harness.maximumConcurrentMutations).toBe(1);
  await expectNoCredentialPersistence(pages, harness.issuedTokens);
});

test('@cross-tab-identity switches a different account without an identity/token mismatch', async ({
  context,
}) => {
  await instrumentLifecycleEvents(context);
  const harness = new AuthHarness();
  const pages = await openUnauthenticatedPages(context, harness, 2);
  const [primaryPage, secondaryPage] = firstTwoPages(pages);
  await login(primaryPage, userA);
  await Promise.all(pages.map((page) => expectUser(page, userA)));

  await primaryPage.getByRole('button', { name: 'Sign in with another account' }).click();
  await expect(primaryPage.getByLabel('Email')).toBeVisible();
  const blockedRefresh = harness.blockNextRefresh(secondaryPage);
  await login(primaryPage, userB);
  await blockedRefresh.started;

  await expect(
    secondaryPage.getByRole('heading', { name: 'Updating your session…' }),
  ).toBeVisible();
  await expect(secondaryPage.getByText(userA.email)).not.toBeVisible();
  await expectUser(primaryPage, userB);

  blockedRefresh.release();
  await Promise.all(pages.map((page) => expectUser(page, userB)));

  const pageTwoSubjects = harness.meSubjects.filter(({ page }) => page === 'page-2');
  expect(pageTwoSubjects.at(-1)?.userId).toBe(userB.id);
  expect(harness.maximumConcurrentMutations).toBe(1);
  expect(harness.replayRevocations).toBe(0);
  const finalCookie = (await context.cookies()).find((cookie) => cookie.name === refreshCookieName);
  expect(finalCookie).toMatchObject({
    httpOnly: true,
    path: refreshCookiePath,
    sameSite: 'Lax',
  });
  const events = (await Promise.all(pages.map(lifecycleEvents))).flat();
  expect(
    events.filter((event) => (event as { type?: unknown }).type === 'session-changed'),
  ).toHaveLength(2);
  expectSafeLifecyclePayloads(events);
  await expectNoCredentialPersistence(pages, harness.issuedTokens);
});

test('@cross-tab-identity clears another tab after confirmed logout without remote calls', async ({
  browserName,
  context,
}) => {
  await instrumentLifecycleEvents(context);
  const harness = new AuthHarness();
  const pages = await openUnauthenticatedPages(context, harness, 2);
  const [primaryPage] = firstTwoPages(pages);
  await login(primaryPage, userA);
  await Promise.all(pages.map((page) => expectUser(page, userA)));
  const requestsBeforeLogout = harness.requestOrder.length;

  await primaryPage.getByRole('button', { name: 'Sign out' }).click();
  await Promise.all(pages.map((page) => expect(page.getByLabel('Email')).toBeVisible()));

  expect(harness.logoutRequests).toBe(1);
  expect(harness.requestOrder.slice(requestsBeforeLogout)).toEqual([
    { operation: 'logout', page: 'page-1' },
  ]);
  const events = (await Promise.all(pages.map(lifecycleEvents))).flat();
  expect(events.filter((event) => (event as { type?: unknown }).type === 'logout')).toHaveLength(1);
  expectSafeLifecyclePayloads(events);

  const refreshesBeforeReload = harness.refreshRequests;
  const meBeforeReload = harness.meSubjects.length;
  await Promise.all(pages.map((page) => page.reload()));
  await Promise.all(pages.map((page) => expect(page.getByLabel('Email')).toBeVisible()));
  await primaryPage.waitForTimeout(200);
  expect(harness.refreshRequests).toBe(refreshesBeforeReload + 2);
  expect(harness.meSubjects).toHaveLength(meBeforeReload);
  expect(harness.logoutRequests).toBe(1);
  if (browserName !== 'webkit') {
    expect((await context.cookies()).some((cookie) => cookie.name === refreshCookieName)).toBe(
      false,
    );
  }
});

test('@cross-tab-identity preserves serialization through repeated account and logout cycles', async ({
  context,
}) => {
  await instrumentLifecycleEvents(context);
  const harness = new AuthHarness();
  const pages = await openUnauthenticatedPages(context, harness, 3);
  const [primaryPage] = firstTwoPages(pages);

  const sequence = [userA, userB, userA, userB] as const;
  for (const [index, user] of sequence.entries()) {
    if (index > 0) {
      await primaryPage.getByRole('button', { name: 'Sign in with another account' }).click();
    }
    await login(primaryPage, user);
    await Promise.all(pages.map((page) => expectUser(page, user)));
  }

  await primaryPage.getByRole('button', { name: 'Sign out' }).click();
  await Promise.all(pages.map((page) => expect(page.getByLabel('Email')).toBeVisible()));
  await login(primaryPage, userA);
  await Promise.all(pages.map((page) => expectUser(page, userA)));

  expect(harness.maximumConcurrentMutations).toBe(1);
  expect(harness.activeMutations).toBe(0);
  expect(harness.replayRevocations).toBe(0);
  expect(harness.logoutRequests).toBe(1);
  const events = (await Promise.all(pages.map(lifecycleEvents))).flat();
  expect(
    events.filter((event) => (event as { type?: unknown }).type === 'session-changed'),
  ).toHaveLength(5);
  expect(events.filter((event) => (event as { type?: unknown }).type === 'logout')).toHaveLength(1);
  expectSafeLifecyclePayloads(events);
  await expectNoCredentialPersistence(pages, harness.issuedTokens);
});

test('@cross-tab-identity fails closed when BroadcastChannel is unavailable', async ({
  context,
  page,
}) => {
  let mutationRequests = 0;
  await page.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', {
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
    page.getByRole('heading', {
      name: 'Your browser cannot safely update sessions across tabs',
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await expect(page.getByLabel('Email')).not.toBeVisible();
  expect(mutationRequests).toBe(0);
});
