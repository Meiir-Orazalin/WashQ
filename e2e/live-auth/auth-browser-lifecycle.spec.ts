import type { BrowserContext, Page, Route } from '@playwright/test';
import {
  acquireAuthLock,
  expect,
  expectNoCredentialPersistence,
  expectSafeLifecycleEvents,
  expectUnauthenticated,
  expectUser,
  inspectLatestFamily,
  instrumentLifecycleEvents,
  lifecycleEvents,
  login,
  pendingAuthLockRequests,
  releaseAuthLock,
  test,
  trackCookieMutations,
  type LiveAuthUser,
} from './auth-test';

const refreshPath = /\/api\/v1\/auth\/refresh$/;
const currentUserPath = /\/api\/v1\/auth\/me$/;
const loginPath = /\/api\/v1\/auth\/login$/;

test.beforeEach(async ({ context }) => {
  await instrumentLifecycleEvents(context);
});

test('@auth-smoke @auth-matrix restores two tabs serially with the real cookie family', async ({
  authUsers,
  context,
}) => {
  const user = await authUsers.create('a');
  await establishCookie(context, user);
  const mutations = trackCookieMutations(context);
  const pages = [await context.newPage(), await context.newPage()];

  await Promise.all(pages.map((page) => page.goto('/login')));
  await Promise.all(pages.map((page) => expectUser(page, user)));

  expect(mutations.maximum).toBe(1);
  expect(mutations.active).toBe(0);
  expect(mutations.statuses).toEqual([200, 200]);
  await expectActiveLatestFamily(user.email);
  await expectRefreshCookie(context);
  await expectNoCredentialPersistence(pages, [user]);
  mutations.dispose();
});

test('@auth-smoke @auth-matrix switches accounts without retaining the old identity', async ({
  authUsers,
  context,
}) => {
  const [userA, userB] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
  const [sender, receiver] = await openUnauthenticatedPages(context, 2);
  if (!sender || !receiver) {
    throw new Error('Two pages are required');
  }
  const mutations = trackCookieMutations(context);

  await login(sender, userA);
  await Promise.all([expectUser(sender, userA), expectUser(receiver, userA)]);

  const refreshBarrier = await blockNextRequest(receiver, refreshPath);
  await sender.getByRole('button', { name: 'Sign in with another account' }).click();
  await login(sender, userB);
  await refreshBarrier.started;

  await expect(receiver.getByRole('heading', { name: 'Updating your session…' })).toBeVisible();
  await expect(receiver.getByText(userA.email)).not.toBeVisible();
  await expectUser(sender, userB);

  refreshBarrier.release();
  await expectUser(receiver, userB);

  expect(mutations.maximum).toBe(1);
  await expectActiveLatestFamily(userB.email);
  const events = await lifecycleEvents([sender, receiver]);
  expect(events.filter(isSessionChanged)).toHaveLength(2);
  expectSafeLifecycleEvents(events);
  await expectNoCredentialPersistence([sender, receiver], [userA, userB]);
  mutations.dispose();
});

test('@auth-smoke @auth-matrix propagates confirmed logout without a remote auth request', async ({
  authUsers,
  context,
}) => {
  const user = await authUsers.create('a');
  const [sender, receiver] = await openUnauthenticatedPages(context, 2);
  if (!sender || !receiver) {
    throw new Error('Two pages are required');
  }
  await login(sender, user);
  await Promise.all([expectUser(sender, user), expectUser(receiver, user)]);

  const remoteAuthRequests: string[] = [];
  receiver.on('request', (request) => {
    if (/\/api\/v1\/auth\/(refresh|logout|me)$/.test(new URL(request.url()).pathname)) {
      remoteAuthRequests.push(new URL(request.url()).pathname);
    }
  });
  const logoutResponse = sender.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/logout') && response.request().method() === 'POST',
  );
  await sender.getByRole('button', { name: 'Sign out' }).click();
  expect((await logoutResponse).status()).toBe(204);
  await Promise.all([expectUnauthenticated(sender), expectUnauthenticated(receiver)]);

  expect(remoteAuthRequests).toEqual([]);
  const latestFamily = await inspectLatestFamily(user.email);
  expect(latestFamily).toMatchObject({
    activeSessions: 0,
    unlinkedRevocations: 1,
    users: 1,
  });
  expect((await context.cookies()).some((cookie) => cookie.name === 'washqueue_refresh')).toBe(
    false,
  );
  const events = await lifecycleEvents([sender, receiver]);
  expect(events.filter(isLogout)).toHaveLength(1);
  expectSafeLifecycleEvents(events);
});

test('@auth-smoke @auth-matrix orders a real refresh before logout', async ({
  authUsers,
  context,
}) => {
  const user = await authUsers.create('a');
  const [refreshPage, logoutPage] = await openUnauthenticatedPages(context, 2);
  if (!refreshPage || !logoutPage) {
    throw new Error('Two pages are required');
  }
  await login(logoutPage, user);
  await Promise.all([expectUser(refreshPage, user), expectUser(logoutPage, user)]);

  const refreshBarrier = await blockNextRequest(refreshPage, refreshPath);
  const order: string[] = [];
  context.on('response', (response) => {
    if (response.url().endsWith('/api/v1/auth/refresh')) {
      order.push(`refresh-${response.status()}`);
    }
  });
  context.on('request', (request) => {
    if (request.url().endsWith('/api/v1/auth/logout')) {
      order.push('logout-start');
    }
  });

  const reload = refreshPage.reload();
  await refreshBarrier.started;
  await logoutPage.getByRole('button', { name: 'Sign out' }).click();
  await expect(logoutPage.getByRole('heading', { name: 'Clearing your session…' })).toBeVisible();
  expect(order).toEqual([]);

  refreshBarrier.release();
  await reload;
  await Promise.all([expectUnauthenticated(refreshPage), expectUnauthenticated(logoutPage)]);

  expect(order).toEqual(['refresh-200', 'logout-start']);
  expect((await inspectLatestFamily(user.email)).activeSessions).toBe(0);
});

test('@auth-matrix repeats simultaneous restoration with bounded rotation stress', async ({
  authUsers,
  context,
}) => {
  const user = await authUsers.create('a');
  await establishCookie(context, user);
  const pages = [await context.newPage(), await context.newPage(), await context.newPage()];
  const mutations = trackCookieMutations(context);

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await Promise.all(pages.map((page) => page.goto('/login')));
    await Promise.all(pages.map((page) => expectUser(page, user)));
  }

  expect(mutations.maximum).toBe(1);
  expect(mutations.active).toBe(0);
  expect(mutations.statuses).toHaveLength(9);
  expect(mutations.statuses.every((status) => status === 200)).toBe(true);
  await expectActiveLatestFamily(user.email);
  mutations.dispose();
});

test('@auth-matrix repeats A/B account switching without replay-family loss', async ({
  authUsers,
  context,
}) => {
  const [userA, userB] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
  const pages = await openUnauthenticatedPages(context, 3);
  const sender = pages[0];
  if (!sender) {
    throw new Error('A sender page is required');
  }
  const mutations = trackCookieMutations(context);
  const sequence = [userA, userB, userA, userB] as const;

  for (const [index, user] of sequence.entries()) {
    if (index > 0) {
      await sender.getByRole('button', { name: 'Sign in with another account' }).click();
    }
    await login(sender, user);
    await Promise.all(pages.map((page) => expectUser(page, user)));
    await expectActiveLatestFamily(user.email);
  }

  expect(mutations.maximum).toBe(1);
  expect(mutations.active).toBe(0);
  const events = await lifecycleEvents(pages);
  expect(events.filter(isSessionChanged)).toHaveLength(sequence.length);
  expectSafeLifecycleEvents(events);
  await expectNoCredentialPersistence(pages, [userA, userB]);
  mutations.dispose();
});

test('@auth-matrix refreshes through /auth/me when the page clock enters the safety window', async ({
  authUsers,
  context,
}) => {
  const user = await authUsers.create('a');
  const [page] = await openUnauthenticatedPages(context, 1);
  if (!page) {
    throw new Error('A page is required');
  }
  await login(page, user);
  await expectUser(page, user);
  const order: string[] = [];
  page.on('response', (response) => {
    if (response.url().endsWith('/api/v1/auth/refresh')) {
      order.push('refresh');
    } else if (response.url().endsWith('/api/v1/auth/me')) {
      order.push('me');
    }
  });

  await page.evaluate(() => {
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + 14 * 60_000 + 30_000;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => order).toEqual(['refresh', 'me']);
  await expectUser(page, user);
  await expectActiveLatestFamily(user.email);
});

test('@auth-matrix releases a queued lock request when the waiting page closes', async ({
  authUsers,
  context,
}) => {
  const user = await authUsers.create('a');
  await establishCookie(context, user);
  const holder = await openAuthenticatedPage(context, user);
  await acquireAuthLock(holder);
  const waiter = await context.newPage();
  let waiterMutations = 0;
  waiter.on('request', (request) => {
    if (/\/api\/v1\/auth\/(login|refresh|logout)$/.test(new URL(request.url()).pathname)) {
      waiterMutations += 1;
    }
  });

  const waitingNavigation = waiter.goto('/login').catch(() => null);
  await expect.poll(() => pendingAuthLockRequests(holder)).toBe(1);
  await waiter.close();
  await waitingNavigation;
  await expect.poll(() => pendingAuthLockRequests(holder)).toBe(0);
  expect(waiterMutations).toBe(0);

  await releaseAuthLock(holder);
  const replacement = await openAuthenticatedPage(context, user);
  await expectUser(replacement, user);
  await expectActiveLatestFamily(user.email);
});

for (const termination of ['close', 'navigate'] as const) {
  test(`@auth-matrix releases a held lock when its page ${termination}s`, async ({
    authUsers,
    context,
  }) => {
    const user = await authUsers.create('a');
    await establishCookie(context, user);
    const holder = await openAuthenticatedPage(context, user);
    await acquireAuthLock(holder);
    const waiter = await context.newPage();
    const waitingNavigation = waiter.goto('/login');
    await expect.poll(() => pendingAuthLockRequests(holder)).toBe(1);

    if (termination === 'close') {
      await holder.close();
    } else {
      await holder.goto('about:blank');
    }

    await waitingNavigation;
    await expectUser(waiter, user);
    await expectActiveLatestFamily(user.email);
  });
}

test('@auth-matrix keeps the cookie usable when a receiver closes during remote synchronization', async ({
  authUsers,
  context,
}) => {
  const [userA, userB] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
  const [sender, receiver, holder] = await openUnauthenticatedPages(context, 3);
  if (!sender || !receiver || !holder) {
    throw new Error('Three pages are required');
  }
  await login(sender, userA);
  await Promise.all([
    expectUser(sender, userA),
    expectUser(receiver, userA),
    expectUser(holder, userA),
  ]);
  const loginBarrier = await blockNextRequest(sender, loginPath);

  await sender.getByRole('button', { name: 'Sign in with another account' }).click();
  await login(sender, userB);
  await loginBarrier.started;
  const holderAcquisition = acquireAuthLock(holder);
  await expect.poll(() => pendingAuthLockRequests(holder)).toBe(1);
  loginBarrier.release();
  await holderAcquisition;
  await expectUser(sender, userB);
  await expect(receiver.getByRole('heading', { name: 'Updating your session…' })).toBeVisible();
  await receiver.close();
  await releaseAuthLock(holder);

  const replacement = await openAuthenticatedPage(context, userB);
  await expectUser(replacement, userB);
  await expectActiveLatestFamily(userB.email);
});

test('@auth-matrix keeps the rotated cookie usable when a receiver closes during /auth/me', async ({
  authUsers,
  context,
}) => {
  const [userA, userB] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
  const [sender, receiver] = await openUnauthenticatedPages(context, 2);
  if (!sender || !receiver) {
    throw new Error('Two pages are required');
  }
  await login(sender, userA);
  await Promise.all([expectUser(sender, userA), expectUser(receiver, userA)]);
  const meBarrier = await blockNextRequest(receiver, currentUserPath);

  await sender.getByRole('button', { name: 'Sign in with another account' }).click();
  await login(sender, userB);
  await meBarrier.started;
  await receiver.close();
  meBarrier.cancel();

  const replacement = await openAuthenticatedPage(context, userB);
  await expectUser(replacement, userB);
  await expectActiveLatestFamily(userB.email);
});

test('@auth-matrix restores authoritative identity after reload interrupts synchronization', async ({
  authUsers,
  context,
}) => {
  const [userA, userB] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
  const [sender, receiver] = await openUnauthenticatedPages(context, 2);
  if (!sender || !receiver) {
    throw new Error('Two pages are required');
  }
  await login(sender, userA);
  await Promise.all([expectUser(sender, userA), expectUser(receiver, userA)]);
  const refreshBarrier = await blockNextRequest(receiver, refreshPath);

  await sender.getByRole('button', { name: 'Sign in with another account' }).click();
  await login(sender, userB);
  await refreshBarrier.started;
  await expect(receiver.getByRole('heading', { name: 'Updating your session…' })).toBeVisible();
  await expect(receiver.getByText(userA.email)).not.toBeVisible();

  const reload = receiver.reload();
  await expectUser(receiver, userB);
  refreshBarrier.release();
  await reload;
  await expectUser(receiver, userB);
  await expectActiveLatestFamily(userB.email);
});

test('@auth-matrix remaining tabs stay stable when a remotely logged-out page closes', async ({
  authUsers,
  context,
}) => {
  const user = await authUsers.create('a');
  const [sender, receiver] = await openUnauthenticatedPages(context, 2);
  if (!sender || !receiver) {
    throw new Error('Two pages are required');
  }
  await login(sender, user);
  await Promise.all([expectUser(sender, user), expectUser(receiver, user)]);

  await sender.getByRole('button', { name: 'Sign out' }).click();
  await Promise.all([expectUnauthenticated(sender), expectUnauthenticated(receiver)]);
  await receiver.close();

  const freshPage = await context.newPage();
  await freshPage.goto('/login');
  await expectUnauthenticated(freshPage);
  expect((await inspectLatestFamily(user.email)).activeSessions).toBe(0);
});

for (const capabilityFailure of ['unavailable', 'constructor-throws'] as const) {
  test(`@auth-matrix fails closed when BroadcastChannel is ${capabilityFailure}`, async ({
    page,
  }) => {
    let mutations = 0;
    page.on('request', (request) => {
      if (/\/api\/v1\/auth\/(login|refresh|logout)$/.test(new URL(request.url()).pathname)) {
        mutations += 1;
      }
    });
    await page.addInitScript((failure) => {
      Object.defineProperty(window, 'BroadcastChannel', {
        configurable: true,
        value:
          failure === 'unavailable'
            ? undefined
            : class FailedBroadcastChannel {
                constructor() {
                  throw new Error('runtime channel construction failed');
                }

                close() {
                  return undefined;
                }
              },
      });
    }, capabilityFailure);

    await page.goto('/login');
    await expect(
      page.getByRole('heading', {
        name: 'Your browser cannot safely update sessions across tabs',
      }),
    ).toBeVisible();
    expect(mutations).toBe(0);
  });
}

test('@auth-matrix fails closed after postMessage throws during explicit login', async ({
  authUsers,
  context,
  page,
}) => {
  const user = await authUsers.create('a');
  await makePostMessageThrow(page, 'session-changed');
  await page.goto('/login');
  await expectUnauthenticated(page);

  await login(page, user);
  await expect(
    page.getByRole('heading', {
      name: 'Your browser cannot safely update sessions across tabs',
    }),
  ).toBeVisible();
  await expect(page.getByText(user.email)).not.toBeVisible();

  const healthyPage = await context.newPage();
  await healthyPage.goto('/login');
  await expectUser(healthyPage, user);
  await expectActiveLatestFamily(user.email);
});

test('@auth-matrix remains cleared when postMessage throws after confirmed logout', async ({
  authUsers,
  context,
  page,
}) => {
  const user = await authUsers.create('a');
  await makePostMessageThrow(page, 'logout');
  await page.goto('/login');
  await expectUnauthenticated(page);
  await login(page, user);
  await expectUser(page, user);

  const logoutResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/v1/auth/logout'),
  );
  await page.getByRole('button', { name: 'Sign out' }).click();
  expect((await logoutResponse).status()).toBe(204);
  await expect(
    page.getByRole('heading', {
      name: 'Your browser cannot safely update sessions across tabs',
    }),
  ).toBeVisible();

  const healthyPage = await context.newPage();
  await healthyPage.goto('/login');
  await expectUnauthenticated(healthyPage);
  expect((await inspectLatestFamily(user.email)).activeSessions).toBe(0);
});

async function establishCookie(context: BrowserContext, user: LiveAuthUser) {
  const seed = await context.newPage();
  await seed.goto('/login');
  await expectUnauthenticated(seed);
  await login(seed, user);
  await expectUser(seed, user);
  await seed.close();
}

async function openUnauthenticatedPages(context: BrowserContext, count: number) {
  const pages = await Promise.all(
    Array.from({ length: count }, async () => {
      const page = await context.newPage();
      await page.goto('/login');
      await expectUnauthenticated(page);
      return page;
    }),
  );
  return pages;
}

async function openAuthenticatedPage(context: BrowserContext, user: LiveAuthUser) {
  const page = await context.newPage();
  await page.goto('/login');
  await expectUser(page, user);
  return page;
}

async function blockNextRequest(page: Page, pattern: RegExp) {
  let releaseRequest: (() => void) | undefined;
  let signalStarted: (() => void) | undefined;
  let shouldBlock = true;
  let completion: 'abort' | 'continue' = 'continue';
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });

  await page.route(pattern, async (route: Route) => {
    if (!shouldBlock) {
      await route.continue();
      return;
    }
    shouldBlock = false;
    signalStarted?.();
    await released;
    if (completion === 'abort') {
      await route.abort('aborted').catch(() => undefined);
    } else {
      await route.continue().catch(() => undefined);
    }
  });

  return {
    cancel() {
      completion = 'abort';
      releaseRequest?.();
    },
    release() {
      releaseRequest?.();
    },
    started,
  };
}

async function expectActiveLatestFamily(email: string) {
  const latestFamily = await inspectLatestFamily(email);
  expect(latestFamily.users).toBe(1);
  expect(latestFamily.familyRows).toBeGreaterThan(0);
  expect(latestFamily.activeSessions).toBe(1);
  expect(latestFamily.unlinkedRevocations).toBe(0);
}

async function expectRefreshCookie(context: BrowserContext) {
  const cookie = (await context.cookies()).find(({ name }) => name === 'washqueue_refresh');
  expect(cookie).toMatchObject({
    httpOnly: true,
    path: '/api/v1/auth',
    sameSite: 'Lax',
  });
}

function isSessionChanged(event: unknown) {
  return (
    typeof event === 'object' &&
    event !== null &&
    'type' in event &&
    event.type === 'session-changed'
  );
}

function isLogout(event: unknown) {
  return typeof event === 'object' && event !== null && 'type' in event && event.type === 'logout';
}

async function makePostMessageThrow(page: Page, eventType: 'session-changed' | 'logout') {
  await page.addInitScript((blockedType) => {
    const NativeBroadcastChannel = window.BroadcastChannel;
    class FailingBroadcastChannel extends NativeBroadcastChannel {
      override postMessage(message: unknown) {
        if (
          typeof message === 'object' &&
          message !== null &&
          'type' in message &&
          message.type === blockedType
        ) {
          throw new Error('runtime lifecycle publication failed');
        }
        super.postMessage(message);
      }
    }
    Object.defineProperty(window, 'BroadcastChannel', {
      configurable: true,
      value: FailingBroadcastChannel,
    });
  }, eventType);
}
