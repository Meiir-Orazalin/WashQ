import type { BrowserContext, Page } from '@playwright/test';
import {
  currentUserResponseSchema,
  loginResponseSchema,
  vehicleListResponseSchema,
} from '@washqueue/contracts';
import {
  expect,
  expectSafeLifecycleEvents,
  expectUser,
  inspectLatestFamily,
  instrumentLifecycleEvents,
  lifecycleEvents,
  login,
  test,
  type LiveAuthUser,
} from './auth-test';

const apiBase = 'http://127.0.0.1:4000/api/v1';
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function bearerFor(user: LiveAuthUser) {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  expect(response.status).toBe(200);
  const parsed = loginResponseSchema.safeParse(await response.json());
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('Invalid temporary login response');
  return parsed.data.accessToken;
}
async function requestProfile(token: string, input: unknown) {
  return fetch(`${apiBase}/users/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}
async function openProfile(page: Page, user: LiveAuthUser) {
  await page.goto('/login');
  await login(page, user);
  await expectUser(page, user);
  await page.getByRole('link', { name: 'Your profile' }).click();
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  await expect(page.getByText(user.email, { exact: true })).toBeVisible();
}
function inspectPrivacy(context: BrowserContext) {
  const secrets: string[] = [];
  const logs: string[] = [];
  const checks: Promise<void>[] = [];
  const cookieSent: boolean[] = [];
  context.on('page', (page) => page.on('console', (message) => logs.push(message.text())));
  context.on('response', (response) => {
    if (
      /\/auth\/(login|refresh)$/.test(new URL(response.url()).pathname) &&
      response.status() === 200
    ) {
      checks.push(
        (async () => {
          const payload: unknown = await response.json();
          if (
            typeof payload === 'object' &&
            payload !== null &&
            'accessToken' in payload &&
            typeof payload.accessToken === 'string'
          )
            secrets.push(payload.accessToken);
        })(),
      );
    }
  });
  context.on('request', (request) => {
    if (/\/(users|auth)\/me$/.test(new URL(request.url()).pathname))
      checks.push(
        (async () => {
          cookieSent.push(Boolean((await request.allHeaders()).cookie));
        })(),
      );
  });
  return async (pages: Page[], users: LiveAuthUser[]) => {
    await Promise.all(checks);
    secrets.push(
      ...users.map(({ password }) => password),
      ...(await context.cookies()).map(({ value }) => value),
    );
    for (const page of pages) {
      const browser = await page.evaluate(async () => ({
        markup: document.documentElement.innerHTML,
        local: { ...localStorage },
        session: { ...sessionStorage },
        cookie: document.cookie,
        indexed: await indexedDB.databases(),
      }));
      expect(secrets.some((secret) => JSON.stringify(browser).includes(secret))).toBe(false);
      expect(browser.local).toEqual({});
      expect(browser.session).toEqual({});
      expect(browser.indexed).toEqual([]);
      expect(browser.cookie.includes('washqueue_refresh')).toBe(false);
      expect(secrets.some((secret) => page.url().includes(secret))).toBe(false);
    }
    expect(cookieSent.some(Boolean)).toBe(false);
    expect(secrets.some((secret) => logs.join('\n').includes(secret))).toBe(false);
  };
}

test('@profile edits names, reloads persisted values, clears surname and preserves related vehicles', async ({
  authUsers,
  context,
}) => {
  const privacy = inspectPrivacy(context);
  const user = await authUsers.create('a');
  const token = await bearerFor(user);
  const vehicle = await fetch(`${apiBase}/vehicles`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ make: 'Toyota', model: 'Camry', plateNumber: 'PROFILE01' }),
  });
  expect(vehicle.status).toBe(201);
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await openProfile(page, user);
  await page.getByRole('button', { name: 'Edit profile' }).focus();
  await page.keyboard.press('Enter');
  const form = page.getByRole('form', { name: 'Edit profile' });
  await expect(form.getByLabel('First name', { exact: true })).toBeFocused();
  await expect(form.getByLabel('Email (read-only)')).toHaveAttribute('readonly', '');
  await expect(form.getByLabel('Email (read-only)')).toHaveValue(user.email);
  await form.getByLabel('First name', { exact: true }).fill(' Updated ');
  await form.getByLabel('Last name (optional)').fill(' Customer ');
  const updated = page.waitForResponse(
    (response) => response.url().endsWith('/users/me') && response.request().method() === 'PATCH',
  );
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  const response = await updated;
  expect(response.status()).toBe(200);
  expect(currentUserResponseSchema.parse(await response.json()).user).toMatchObject({
    firstName: 'Updated',
    lastName: 'Customer',
    email: user.email,
  });
  expect(Boolean((await response.allHeaders())['set-cookie'])).toBe(false);
  await expect(page.getByText('Profile updated.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit profile' })).toBeFocused();
  await page.reload();
  await expect(page.getByText('Updated', { exact: true })).toBeVisible();
  await expect(page.getByText('Customer', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await form.getByLabel('Last name (optional)').fill('');
  const cleared = page.waitForResponse(
    (result) => result.url().endsWith('/users/me') && result.request().method() === 'PATCH',
  );
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  expect(currentUserResponseSchema.parse(await (await cleared).json()).user.lastName).toBeNull();
  await expect(form).not.toBeVisible();
  await page.reload();
  await expect(page.getByText('Updated', { exact: true })).toBeVisible();
  await expect(page.getByText('Last name', { exact: true })).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await privacy([page], [user]);
  await page.getByRole('link', { name: 'Your vehicles' }).click();
  await expect(page.getByRole('listitem')).toContainText('PROFILE01');
  const list = await fetch(`${apiBase}/vehicles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(vehicleListResponseSchema.parse(await list.json()).vehicles).toHaveLength(1);
});

test('@profile immutable and identity fields cannot be changed by direct authenticated API requests', async ({
  authUsers,
}) => {
  const [a, b] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
  const [tokenA, tokenB] = await Promise.all([bearerFor(a), bearerFor(b)]);
  for (const field of [
    'email',
    'userId',
    'ownerUserId',
    'id',
    'password',
    'passwordHash',
    'roles',
    'sessions',
  ]) {
    const response = await requestProfile(tokenA, { firstName: 'Spoofed', [field]: 'rejected' });
    expect(response.status).toBe(400);
  }
  expect((await requestProfile(tokenA, {})).status).toBe(400);
  for (const [token, user] of [
    [tokenA, a],
    [tokenB, b],
  ] as const) {
    const response = await fetch(`${apiBase}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(currentUserResponseSchema.parse(await response.json()).user).toMatchObject({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    });
  }
});

test('@profile same-user tabs synchronize through one non-sensitive event and me without rotating the cookie', async ({
  authUsers,
  context,
}) => {
  await instrumentLifecycleEvents(context);
  const privacy = inspectPrivacy(context);
  const user = await authUsers.create('a');
  const sender = await context.newPage();
  await openProfile(sender, user);
  const receiver = await context.newPage();
  await receiver.goto('/profile');
  await expect(receiver.getByText(user.email, { exact: true })).toBeVisible();
  const beforeCookie = (await context.cookies()).find(
    ({ name }) => name === 'washqueue_refresh',
  )?.value;
  const beforeFamily = await inspectLatestFamily(user.email);
  let refreshes = 0;
  let remoteMe = 0;
  context.on('request', (request) => {
    if (request.url().endsWith('/auth/refresh')) refreshes += 1;
  });
  receiver.on('request', (request) => {
    if (request.url().endsWith('/auth/me')) remoteMe += 1;
  });
  const beforeEvents = (await lifecycleEvents([sender, receiver])).length;
  await sender.getByRole('button', { name: 'Edit profile' }).click();
  await sender.getByLabel('First name', { exact: true }).fill('Synchronized');
  await sender.getByRole('button', { name: 'Save', exact: true }).click();
  for (const page of [sender, receiver])
    await expect(page.getByText('Synchronized', { exact: true })).toBeVisible();
  const events = (await lifecycleEvents([sender, receiver])).slice(beforeEvents);
  expectSafeLifecycleEvents(events);
  expect(events).toEqual([{ type: 'profile-changed', sourceId: expect.any(String) }]);
  expect(
    [user.email, user.firstName, user.lastName, 'Synchronized'].some((value) =>
      JSON.stringify(events).includes(value),
    ),
  ).toBe(false);
  expect(remoteMe).toBe(1);
  expect(refreshes).toBe(0);
  expect(
    (await context.cookies()).find(({ name }) => name === 'washqueue_refresh')?.value ===
      beforeCookie,
  ).toBe(true);
  expect(await inspectLatestFamily(user.email)).toEqual(beforeFamily);
  await privacy([sender, receiver], [user]);
  await sender.getByRole('button', { name: 'Sign out' }).click();
  for (const page of [sender, receiver]) {
    await expect(page.getByText('Sign in to view and edit your profile.')).toBeVisible();
    await expect(page.getByText('Synchronized', { exact: true })).not.toBeVisible();
  }
});

test('@profile an account switch discards a delayed old-account profile completion', async ({
  authUsers,
  context,
}) => {
  await instrumentLifecycleEvents(context);
  const privacy = inspectPrivacy(context);
  const [a, b] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
  const sender = await context.newPage();
  await openProfile(sender, a);
  const receiver = await context.newPage();
  await receiver.goto('/profile');
  await expect(receiver.getByText(a.email, { exact: true })).toBeVisible();
  const started = barrier();
  const release = barrier();
  await receiver.route('**/api/v1/users/me', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    started.release();
    await release.promise;
    // The old subtree aborts this request when identity leaves authenticated A.
    await route.fulfill({ response }).catch(() => undefined);
  });
  await receiver.getByRole('button', { name: 'Edit profile' }).click();
  await receiver.getByLabel('First name', { exact: true }).fill('DelayedAlpha');
  await receiver.getByRole('button', { name: 'Save', exact: true }).click();
  await started.promise;
  const syncStarted = barrier();
  const syncRelease = barrier();
  await receiver.route(
    '**/api/v1/auth/refresh',
    async (route) => {
      syncStarted.release();
      await syncRelease.promise;
      await route.continue();
    },
    { times: 1 },
  );
  await sender.getByRole('link', { name: 'Manage sign-in' }).click();
  await sender.getByRole('button', { name: 'Sign in with another account' }).click();
  await login(sender, b);
  await syncStarted.promise;
  await expect(receiver.getByText('Updating your session…')).toBeVisible();
  await expect(receiver.getByText(a.email, { exact: true })).not.toBeVisible();
  await expect(receiver.getByRole('form', { name: 'Edit profile' })).not.toBeVisible();
  syncRelease.release();
  await expect(receiver.getByText(b.email, { exact: true })).toBeVisible();
  await receiver.evaluate(() => {
    const state = window as Window & { __staleProfileVisible?: boolean };
    state.__staleProfileVisible = false;
    new MutationObserver(() => {
      if (/DelayedAlpha|Profile updated\./.test(document.body.textContent ?? ''))
        state.__staleProfileVisible = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  release.release();
  await receiver.unrouteAll({ behavior: 'wait' });
  await sender.getByRole('link', { name: 'Your profile' }).click();
  for (const page of [sender, receiver]) {
    await expect(page.getByText(b.email, { exact: true })).toBeVisible();
    await expect(page.getByText('Profile updated.')).not.toBeVisible();
    await expect(page.getByText('DelayedAlpha')).not.toBeVisible();
  }
  expect(
    await receiver.evaluate(
      () => (window as Window & { __staleProfileVisible?: boolean }).__staleProfileVisible,
    ),
  ).toBe(false);
  const events = await lifecycleEvents([sender, receiver]);
  expectSafeLifecycleEvents(events);
  expect(events.some((event) => (event as { type: string }).type === 'profile-changed')).toBe(
    false,
  );
  await privacy([sender, receiver], [a, b]);
});
