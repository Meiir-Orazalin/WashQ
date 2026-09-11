import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import {
  createOrganizationResponseSchema,
  organizationListResponseSchema,
  loginResponseSchema,
  organizationDetailResponseSchema,
} from '@washqueue/contracts';
import {
  expect,
  expectUser,
  inspectOrganizationCounts,
  verifyOrganizationRollback,
  instrumentLifecycleEvents,
  lifecycleEvents,
  expectSafeLifecycleEvents,
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
  if (!parsed.success) throw new Error('Invalid login response');
  return parsed.data.accessToken;
}
async function create(token: string, values: unknown) {
  return fetch(`${apiBase}/organizations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });
}
async function createValid(token: string, name: string) {
  const response = await create(token, { name });
  expect(response.status).toBe(201);
  return createOrganizationResponseSchema.parse(await response.json()).organization;
}
async function list(token: string) {
  const response = await fetch(`${apiBase}/organizations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return organizationListResponseSchema.parse(await response.json()).organizations;
}
async function detail(token: string, id: string) {
  return fetch(`${apiBase}/organizations/${id}`, { headers: { Authorization: `Bearer ${token}` } });
}

// Test-only read of QueryClient state; no access to AuthenticationProvider's private state.
async function inspectQueryState(page: Page) {
  return page.evaluate(() => {
    interface QueryView {
      queryKey: readonly unknown[];
      state: { data: unknown };
    }
    interface ClientView {
      getQueryCache(): { getAll(): QueryView[] };
      getMutationCache(): { getAll(): { state: { data: unknown; variables: unknown } }[] };
    }
    interface Fiber {
      return?: Fiber;
      memoizedProps?: { client?: ClientView };
    }
    const element = document.querySelector('button, input');
    const key = element && Object.keys(element).find((value) => value.startsWith('__reactFiber$'));
    let fiber = element && key ? (Reflect.get(element, key) as Fiber | undefined) : undefined;
    while (fiber) {
      const client = fiber.memoizedProps?.client;
      if (client?.getQueryCache)
        return {
          keys: client
            .getQueryCache()
            .getAll()
            .map(({ queryKey }) => queryKey),
          serialized: JSON.stringify({
            queries: client
              .getQueryCache()
              .getAll()
              .map(({ queryKey, state }) => ({ queryKey, data: state.data })),
            mutations: client
              .getMutationCache()
              .getAll()
              .map(({ state }) => ({ data: state.data, variables: state.variables })),
          }),
        };
      fiber = fiber.return;
    }
    return null;
  });
}

function monitorPrivacy(context: BrowserContext) {
  const credentials: string[] = [];
  const pending: Promise<void>[] = [];
  const logs: string[] = [];
  const cookieFlags: boolean[] = [];
  context.on('page', (page) => page.on('console', (message) => logs.push(message.text())));
  context.on('response', (response) => {
    if (
      /\/auth\/(login|refresh)$/.test(new URL(response.url()).pathname) &&
      response.status() === 200
    )
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
  });
  context.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/organizations'))
      pending.push(
        (async () => {
          cookieFlags.push(Boolean((await request.allHeaders()).cookie));
        })(),
      );
  });
  return async (pages: Page[], users: LiveAuthUser[]) => {
    await Promise.all(pending);
    const secrets = [
      ...credentials,
      ...(await context.cookies()).map(({ value }) => value),
      ...users.map(({ password }) => password),
      process.env.ACCESS_TOKEN_SIGNING_SECRET,
    ].filter((value): value is string => Boolean(value));
    for (const page of pages) {
      const visible = await page.evaluate(async () =>
        JSON.stringify({
          html: document.documentElement.innerHTML,
          url: location.href,
          local: { ...localStorage },
          session: { ...sessionStorage },
          cookie: document.cookie,
          databases: await indexedDB.databases(),
        }),
      );
      const queries = await inspectQueryState(page);
      expect(queries !== null).toBe(true);
      expect(
        secrets.some(
          (value) => visible.includes(value) || Boolean(queries?.serialized.includes(value)),
        ),
      ).toBe(false);
      expect(
        await page.evaluate(
          () =>
            localStorage.length === 0 &&
            sessionStorage.length === 0 &&
            !document.cookie.includes('washqueue_refresh'),
        ),
      ).toBe(true);
    }
    expect(secrets.some((value) => logs.join('\n').includes(value))).toBe(false);
    expect(cookieFlags.some(Boolean)).toBe(false);
  };
}

test('@organizations creates, lists and opens persisted owner detail with accessible mobile controls', async ({
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
  await page.getByRole('link', { name: 'Your organizations' }).click();
  await expect(
    page.getByText('No organizations yet. Create your first organization.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByLabel('Organization name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Organization name').fill(' Ａstana   Premium Wash ');
  await page.getByLabel('Organization name').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Description (optional)')).toBeFocused();
  await page.getByLabel('Description (optional)').fill(' Plain <b>text</b>\nSecond line. ');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/organizations') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create organization' }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(createOrganizationResponseSchema.safeParse(await response.json()).success).toBe(true);
  await expect(page.getByText('Organization created.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Organization name')).toHaveValue('');
  await expect(page.getByLabel('Description (optional)')).toHaveValue('');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.locator('.organization-description b')).toHaveCount(0);
  await privacy([page], [user]);
  await page.getByRole('link', { name: 'Astana Premium Wash', exact: true }).click();
  await expect(page).toHaveURL(/\/business\/organizations\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Astana Premium Wash' })).toBeVisible();
  await expect(page.getByText('Branches will be added in the next version.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Astana Premium Wash' })).toBeVisible();
  await expect(page.locator('.organization-description')).toHaveText(
    'Plain <b>text</b>\nSecond line.',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const queries = await inspectQueryState(page);
  expect(queries?.keys.length).toBe(1);
  expect(queries?.keys.every((key) => key[0] === 'organization' && key.length === 3)).toBe(true);
  expect(await inspectOrganizationCounts(user.email)).toEqual({
    organizations: 1,
    memberships: 1,
    owners: 1,
  });
  await privacy([page], [user]);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText('Sign in to create and view your organizations.')).toBeVisible();
  await expect(page.getByText('Astana Premium Wash')).not.toBeVisible();
});

test('@organizations enforces membership ownership, allows equal names and rejects spoofing with private 404s', async ({
  authUsers,
  browser,
}) => {
  const [a, b] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
  const [tokenA, tokenB] = await Promise.all([bearerFor(a), bearerFor(b)]);
  const organizationA = await createValid(tokenA, 'Shared name');
  const organizationB = await createValid(tokenB, 'Shared name');
  const anotherA = await createValid(tokenA, 'Shared name');
  expect((await list(tokenA)).map(({ id }) => id)).toEqual([anotherA.id, organizationA.id]);
  expect(await list(tokenB)).toEqual([organizationB]);
  for (const field of [
    'userId',
    'ownerUserId',
    'membershipRole',
    'membershipId',
    'roles',
    'password',
    'token',
  ])
    expect((await create(tokenA, { name: 'Spoofed', [field]: 'untrusted' })).status).toBe(400);
  const foreign = await detail(tokenB, organizationA.id);
  const missing = await detail(tokenB, randomUUID());
  expect(foreign.status).toBe(404);
  expect(missing.status).toBe(404);
  const foreignBody = await foreign.json();
  const missingBody = await missing.json();
  expect(foreignBody.error).toEqual(missingBody.error);
  expect(foreignBody.error).toEqual({
    code: 'ORGANIZATION_NOT_FOUND',
    message: 'The organization was not found',
  });
  expect(
    organizationDetailResponseSchema.parse(await (await detail(tokenA, organizationA.id)).json())
      .organization,
  ).toEqual(organizationA);
  const contexts = [await browser.newContext(), await browser.newContext()];
  try {
    for (const [index, user] of [a, b].entries()) {
      const context = contexts[index];
      if (!context) throw new Error('Missing isolated context');
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:3000/login');
      await login(page, user);
      await expectUser(page, user);
      await page.getByRole('link', { name: 'Your organizations' }).click();
      await expect(page.getByRole('listitem')).toHaveCount(index === 0 ? 2 : 1);
      if (index === 1) {
        await page.goto(`http://127.0.0.1:3000/business/organizations/${organizationA.id}`);
        await expect(
          page.getByRole('alert').filter({ hasText: 'This organization is not available.' }),
        ).toHaveText('This organization is not available.');
        await expect(page.getByText('Shared name')).not.toBeVisible();
      }
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
  expect(await inspectOrganizationCounts(a.email)).toEqual({
    organizations: 2,
    memberships: 2,
    owners: 2,
  });
  expect(await inspectOrganizationCounts(b.email)).toEqual({
    organizations: 1,
    memberships: 1,
    owners: 1,
  });
});

test('@organizations built production transaction rolls back a failed owner membership', async ({
  authUsers,
}) => {
  const user = await authUsers.create('a');
  expect(await verifyOrganizationRollback(user.email)).toEqual({
    failed: true,
    remainingOrganizations: 0,
    membershipsUnchanged: true,
  });
  expect(await inspectOrganizationCounts(user.email)).toEqual({
    organizations: 0,
    memberships: 0,
    owners: 0,
  });
});

for (const mode of ['list', 'detail'] as const) {
  test(`@organizations account switch hides ${mode} immediately and rejects delayed previous-owner data`, async ({
    authUsers,
    context,
  }) => {
    await instrumentLifecycleEvents(context);
    const privacy = monitorPrivacy(context);
    const [a, b] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
    const [tokenA, tokenB] = await Promise.all([bearerFor(a), bearerFor(b)]);
    const organizationA = await createValid(tokenA, 'Alpha Organization');
    await createValid(tokenB, 'Beta Organization');
    const sender = await context.newPage();
    await sender.goto('/login');
    await login(sender, a);
    await expectUser(sender, a);
    await sender.getByRole('link', { name: 'Your organizations' }).click();
    const receiver = await context.newPage();
    const path =
      mode === 'list' ? '/business/organizations' : `/business/organizations/${organizationA.id}`;
    await receiver.goto(path);
    await expect(
      receiver.getByRole(mode === 'list' ? 'link' : 'heading', {
        name: 'Alpha Organization',
        exact: true,
      }),
    ).toBeVisible();
    const oldStarted = barrier();
    const releaseOld = barrier();
    let held = false;
    await receiver.route(
      mode === 'list' ? '**/api/v1/organizations' : `**/api/v1/organizations/${organizationA.id}`,
      async (route) => {
        if (held) {
          await route.continue();
          return;
        }
        held = true;
        const response = await route.fetch();
        oldStarted.release();
        await releaseOld.promise;
        await route.fulfill({ response }).catch(() => undefined); // Old identity intentionally aborts transport.
      },
    );
    await receiver.reload();
    await oldStarted.promise;
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
    await expect(receiver.getByText('Alpha Organization', { exact: true })).not.toBeVisible();
    await expect(receiver.getByLabel('Organization name')).not.toBeVisible();
    releaseSync.release();
    await expect(receiver.getByText(`${b.firstName} ${b.lastName}`, { exact: true })).toBeVisible();
    if (mode === 'list')
      await expect(receiver.getByRole('link', { name: 'Beta Organization' })).toBeVisible();
    else
      await expect(
        receiver.getByRole('alert').filter({ hasText: 'This organization is not available.' }),
      ).toHaveText('This organization is not available.');
    await receiver.evaluate(() => {
      const state = window as Window & { __staleOrganizationVisible?: boolean };
      state.__staleOrganizationVisible = false;
      new MutationObserver(() => {
        if (document.body.textContent?.includes('Alpha Organization'))
          state.__staleOrganizationVisible = true;
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    releaseOld.release();
    await receiver.unrouteAll({ behavior: 'wait' });
    expect(
      await receiver.evaluate(
        () =>
          (window as Window & { __staleOrganizationVisible?: boolean }).__staleOrganizationVisible,
      ),
    ).toBe(false);
    const queryState = await inspectQueryState(receiver);
    expect(queryState !== null && !queryState.serialized.includes('Alpha Organization')).toBe(true);
    if (mode === 'detail')
      await receiver.getByRole('link', { name: 'Back to your organizations' }).click();
    await sender.getByRole('link', { name: 'Your organizations' }).click();
    for (const page of [sender, receiver]) {
      await expect(page.getByRole('listitem')).toHaveCount(1);
      await expect(page.getByRole('link', { name: 'Beta Organization' })).toBeVisible();
      await expect(page.getByText('Alpha Organization', { exact: true })).not.toBeVisible();
    }
    expectSafeLifecycleEvents(await lifecycleEvents([sender, receiver]));
    await privacy([sender, receiver], [a, b]);
    await sender.getByRole('button', { name: 'Sign out' }).click();
    for (const page of [sender, receiver]) {
      await expect(page.getByText('Sign in to create and view your organizations.')).toBeVisible();
      await expect(page.getByText('Beta Organization')).not.toBeVisible();
    }
  });
}
