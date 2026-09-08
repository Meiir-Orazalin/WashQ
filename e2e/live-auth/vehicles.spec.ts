import type { BrowserContext, Page } from '@playwright/test';
import {
  createVehicleResponseSchema,
  loginResponseSchema,
  vehicleListResponseSchema,
} from '@washqueue/contracts';
import {
  expect,
  expectUser,
  inspectVehicleCount,
  login,
  test,
  type LiveAuthUser,
} from './auth-test';

const apiBase = 'http://127.0.0.1:4000/api/v1';
const input = {
  make: 'Toyota',
  model: 'Camry',
  plateNumber: '123 ABC 01',
  productionYear: 2024,
  color: 'Black',
};

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
  return loginResponseSchema.parse(await response.json()).accessToken;
}

async function create(token: string, values: unknown = input) {
  return fetch(`${apiBase}/vehicles`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });
}

async function list(token: string) {
  const response = await fetch(`${apiBase}/vehicles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return vehicleListResponseSchema.parse(await response.json()).vehicles;
}

function monitorPrivacy(context: BrowserContext) {
  const credentials: string[] = [];
  const pending: Promise<void>[] = [];
  const logs: string[] = [];
  const cookieFlags: boolean[] = [];
  context.on('page', (page) => page.on('console', (message) => logs.push(message.text())));
  context.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (/\/auth\/(login|refresh)$/.test(path) && response.status() === 200) {
      pending.push(
        (async () => {
          const body: unknown = await response.json();
          if (
            typeof body === 'object' &&
            body !== null &&
            'accessToken' in body &&
            typeof body.accessToken === 'string'
          )
            credentials.push(body.accessToken);
        })(),
      );
    }
  });
  context.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/vehicles') {
      pending.push(
        (async () => {
          const headers = await request.allHeaders();
          cookieFlags.push(Boolean(headers.cookie));
        })(),
      );
    }
  });
  return async (pages: Page[], users: LiveAuthUser[]) => {
    await Promise.all(pending);
    const cookies = await context.cookies();
    const secrets = [
      ...credentials,
      ...cookies.map(({ value }) => value),
      ...users.map(({ password }) => password),
      process.env.ACCESS_TOKEN_SIGNING_SECRET,
    ].filter((value): value is string => Boolean(value));
    for (const page of pages) {
      const visibleState = await page.evaluate(async () =>
        JSON.stringify({
          html: document.documentElement.innerHTML,
          local: { ...localStorage },
          session: { ...sessionStorage },
          cookie: document.cookie,
          databases: await indexedDB.databases(),
        }),
      );
      expect(secrets.some((secret) => visibleState.includes(secret))).toBe(false);
      expect(
        await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0),
      ).toBe(true);
    }
    expect(secrets.some((secret) => logs.join('\n').includes(secret))).toBe(false);
    expect(cookieFlags.some(Boolean)).toBe(false);
  };
}

test('@vehicles creates, reloads and lists a persisted vehicle with accessible mobile controls', async ({
  authUsers,
  context,
}) => {
  const privacy = monitorPrivacy(context);
  const user = await authUsers.create('a');
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await login(page, user);
  await expectUser(page, user);
  await page.getByRole('link', { name: 'Your vehicles' }).click();
  await expect(page.getByText('No vehicles yet. Add your first vehicle.')).toBeVisible();
  await page.getByLabel('Make', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Model', { exact: true })).toBeFocused();
  for (const [label, value] of [
    ['Make', ' Toyota '],
    ['Model', 'Camry'],
    ['Plate number', '123-abc-01'],
    ['Production year (optional)', '2024'],
    ['Color (optional)', 'Black'],
  ] as const) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByRole('button', { name: 'Add vehicle' }).click();
  await expect(page.getByText('Vehicle added.', { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem')).toContainText('123ABC01');
  await expect(page.getByLabel('Make', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(page.getByText(user.email)).toBeVisible();
  await expect(page.getByRole('listitem')).toContainText('123ABC01');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await inspectVehicleCount(user.email)).toEqual({ vehicles: 1 });
  await privacy([page], [user]);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Sign in to add and view your vehicles.')).toBeVisible();
  await expect(page.getByText('123ABC01')).not.toBeVisible();
  await page.reload();
  await expect(page.getByText('Sign in to add and view your vehicles.')).toBeVisible();
});

test('@vehicles enforces ownership, rejects spoofing and resolves concurrent equivalents to 201/409', async ({
  authUsers,
}) => {
  const [a, b] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
  const [tokenA, tokenB] = await Promise.all([bearerFor(a), bearerFor(b)]);
  expect((await create(tokenB)).status).toBe(201);
  const responses = await Promise.all([
    create(tokenA),
    create(tokenA, { ...input, plateNumber: '123-abc-01' }),
  ]);
  expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
  const conflict = responses.find(({ status }) => status === 409);
  if (!conflict) throw new Error('The controlled duplicate conflict is missing');
  const conflictBody: unknown = await conflict.json();
  expect(conflictBody).toMatchObject({ error: { code: 'VEHICLE_ALREADY_EXISTS' } });
  const [listA, listB] = await Promise.all([list(tokenA), list(tokenB)]);
  expect(listA).toHaveLength(1);
  expect(listB).toHaveLength(1);
  expect(listA[0]?.id === listB[0]?.id).toBe(false);
  expect(Object.keys(listA[0] ?? {})).not.toContain('ownerUserId');
  for (const field of ['ownerUserId', 'userId'])
    expect((await create(tokenA, { ...input, [field]: 'spoofed' })).status).toBe(400);
  expect(await inspectVehicleCount(a.email)).toEqual({ vehicles: 1 });
  expect(await inspectVehicleCount(b.email)).toEqual({ vehicles: 1 });
});

test('@vehicles cross-tab account switch hides A immediately and rejects its delayed response', async ({
  authUsers,
  context,
}) => {
  const privacy = monitorPrivacy(context);
  const [a, b] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
  const [tokenA, tokenB] = await Promise.all([bearerFor(a), bearerFor(b)]);
  expect((await create(tokenA, { ...input, make: 'Alpha Make' })).status).toBe(201);
  expect((await create(tokenB, { ...input, make: 'Beta Make' })).status).toBe(201);
  const sender = await context.newPage();
  await sender.goto('/login');
  await login(sender, a);
  await expectUser(sender, a);
  await sender.getByRole('link', { name: 'Your vehicles' }).click();
  const receiver = await context.newPage();
  await receiver.goto('/vehicles');
  for (const page of [sender, receiver])
    await expect(page.getByRole('listitem')).toContainText('Alpha Make');

  const oldListStarted = barrier();
  const releaseOldList = barrier();
  let held = false;
  await receiver.route('**/api/v1/vehicles', async (route) => {
    if (held || route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    held = true;
    const response = await route.fetch();
    oldListStarted.release();
    await releaseOldList.promise;
    await route.fulfill({ response }).catch(() => undefined); // Expected: auth transition aborts this request.
  });
  await receiver.reload();
  await oldListStarted.promise;
  const syncStarted = barrier();
  const releaseSync = barrier();
  await receiver.route(
    '**/api/v1/auth/refresh',
    async (route) => {
      syncStarted.release();
      await releaseSync.promise;
      await route.continue();
    },
    { times: 1 },
  );
  await sender.getByRole('link', { name: 'Manage sign-in' }).click();
  await sender.getByRole('button', { name: 'Sign in with another account' }).click();
  await login(sender, b);
  await syncStarted.promise;
  await expect(receiver.getByText('Updating your session…')).toBeVisible();
  await expect(receiver.getByText(a.email)).not.toBeVisible();
  await expect(receiver.getByText('Alpha Make Camry')).not.toBeVisible();
  await expect(receiver.getByLabel('Make', { exact: true })).not.toBeVisible();
  releaseSync.release();
  await expect(receiver.getByText(b.email)).toBeVisible();
  await expect(receiver.getByRole('listitem')).toContainText('Beta Make');
  await receiver.evaluate(() => {
    const state = window as Window & { __staleVehicleVisible?: boolean };
    state.__staleVehicleVisible = false;
    new MutationObserver(() => {
      if (document.body.textContent?.includes('Alpha Make')) state.__staleVehicleVisible = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  releaseOldList.release();
  await receiver.unrouteAll({ behavior: 'wait' });
  await sender.getByRole('link', { name: 'Your vehicles' }).click();
  for (const page of [sender, receiver]) {
    await expect(page.getByRole('listitem')).toContainText('Beta Make');
    await expect(page.getByText('Alpha Make Camry')).not.toBeVisible();
  }
  expect(
    await receiver.evaluate(
      () => (window as Window & { __staleVehicleVisible?: boolean }).__staleVehicleVisible,
    ),
  ).toBe(false);
  await privacy([sender, receiver], [a, b]);
  await sender.getByRole('button', { name: 'Sign out' }).click();
  for (const page of [sender, receiver]) {
    await expect(page.getByText('Sign in to add and view your vehicles.')).toBeVisible();
    await expect(page.getByText('Beta Make Camry')).not.toBeVisible();
  }
});

test('@vehicles shares a plate across two separately authenticated browser contexts without sharing lists', async ({
  authUsers,
  browser,
}) => {
  const [a, b] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
  const contexts = [await browser.newContext(), await browser.newContext()];
  try {
    for (const [index, user] of [a, b].entries()) {
      const context = contexts[index];
      if (!context) throw new Error('An isolated context is required');
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:3000/login');
      await login(page, user);
      await expectUser(page, user);
      await page.getByRole('link', { name: 'Your vehicles' }).click();
      await expect(page.getByText('No vehicles yet. Add your first vehicle.')).toBeVisible();
      for (const [label, value] of [
        ['Make', index === 0 ? 'Alpha Make' : 'Beta Make'],
        ['Model', 'Camry'],
        ['Plate number', '123 ABC 01'],
      ] as const)
        await page.getByLabel(label, { exact: true }).fill(value);
      const responsePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith('/vehicles') && response.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Add vehicle' }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(201);
      expect(createVehicleResponseSchema.safeParse(await response.json()).success).toBe(true);
      await expect(page.getByRole('listitem')).toContainText(
        index === 0 ? 'Alpha Make' : 'Beta Make',
      );
    }
    for (const [index, context] of contexts.entries()) {
      const page = context.pages()[0];
      if (!page) throw new Error('An authenticated page is required');
      await page.reload();
      await expect(page.getByRole('listitem')).toHaveCount(1);
      await expect(page.getByRole('listitem')).toContainText(
        index === 0 ? 'Alpha Make' : 'Beta Make',
      );
      await expect(
        page.getByText(index === 0 ? 'Beta Make Camry' : 'Alpha Make Camry'),
      ).not.toBeVisible();
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
