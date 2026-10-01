import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import {
  loginResponseSchema,
  createOrganizationResponseSchema,
  createBranchResponseSchema,
  washBoxResponseSchema,
  washBoxListResponseSchema,
} from '@washqueue/contracts';
import { test, expect, login, expectUser, type LiveAuthUser } from './auth-test';
const apiBase = 'http://127.0.0.1:4000/api/v1';
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function bearerFor(user: LiveAuthUser) {
  const response = await fetch(apiBase + '/auth/login', {
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
async function apiCall(token: string, path: string, method = 'GET', body?: unknown) {
  return fetch(apiBase + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function fixtures(token: string, name: string) {
  const orgResponse = await apiCall(token, '/organizations', 'POST', { name });
  expect(orgResponse.status).toBe(201);
  const org = createOrganizationResponseSchema.parse(await orgResponse.json()).organization;
  const branchResponse = await apiCall(token, `/organizations/${org.id}/branches`, 'POST', {
    name: name + ' Branch',
    city: 'Astana',
    addressLine: 'Address 12',
    timeZone: 'Asia/Almaty',
  });
  expect(branchResponse.status).toBe(201);
  const branch = createBranchResponseSchema.parse(await branchResponse.json()).branch;
  return { org, branch };
}
const boxPath = (org: string, branch: string, box?: string) =>
  `/organizations/${org}/branches/${branch}/wash-boxes${box ? '/' + box : ''}`;
const pagePath = (org: string, branch: string, box?: string) =>
  '/business' + boxPath(org, branch, box);
async function createBox(token: string, org: string, branch: string, number: number) {
  const response = await apiCall(token, boxPath(org, branch), 'POST', { number });
  expect(response.status).toBe(201);
  return washBoxResponseSchema.parse(await response.json()).washBox;
}
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

test('@wash-boxes creates, orders, reloads, confirms deactivation and reactivates with keyboard/mobile privacy', async ({
  authUsers,
  context,
}) => {
  const privacy = monitorPrivacy(context);
  const user = await authUsers.create('a');
  const token = await bearerFor(user);
  const { org, branch } = await fixtures(token, 'Wash Box Owner');
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await login(page, user);
  await expectUser(page, user);
  await page.goto('/business/organizations/' + org.id + '/branches/' + branch.id);
  await page.getByRole('link', { name: 'Manage wash boxes' }).click();
  await expect(page.getByText('No wash boxes saved for this branch yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Create box' }).click();
  await expect(page.getByLabel('Box number')).toHaveAttribute('aria-invalid', 'true');
  for (const number of ['2', '1']) {
    await page.getByLabel('Box number').fill(number);
    await page.getByLabel('Box number').press('Enter');
    await expect(page.getByRole('heading', { name: 'Box ' + number, exact: true })).toBeVisible();
    await expect(page.getByLabel('Box number')).toHaveValue('');
  }
  await expect(
    page.getByRole('list', { name: 'Branch wash boxes' }).getByRole('heading'),
  ).toHaveText(['Box 1', 'Box 2']);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Box 1', exact: true })).toBeVisible();
  let patches = 0;
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes('/wash-boxes/')) patches++;
  });
  await page.getByRole('button', { name: 'Disable Box 1' }).click();
  await expect(page.getByRole('button', { name: 'Confirm deactivation' })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Disable Box 1' })).toBeFocused();
  expect(patches).toBe(0);
  await page.getByRole('button', { name: 'Disable Box 1' }).click();
  await page.getByRole('button', { name: 'Confirm deactivation' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Enable Box 1' })).toBeVisible();
  expect(patches).toBe(1);
  await page.getByLabel('Box number').fill('1');
  await page.getByRole('button', { name: 'Create box' }).click();
  await expect(page.getByRole('form', { name: 'Create wash box' }).getByRole('alert')).toHaveText(
    /already used.*inactive/,
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Enable Box 1' })).toBeVisible();
  await page.getByRole('link', { name: 'View Box 1' }).click();
  await page.waitForURL(/\/wash-boxes\/[a-f0-9-]+$/);
  await expect(page.getByRole('heading', { name: 'Wash box', exact: true })).toBeVisible();
  await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Enable Box 1' }).press('Enter');
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await privacy([page], [user]);
});

test('@wash-boxes owner privacy, wrong nesting, immutable input and concurrent duplicates', async ({
  authUsers,
  context,
}) => {
  const privacy = monitorPrivacy(context);
  const a = await authUsers.create('a');
  const b = await authUsers.create('b');
  const tokenA = await bearerFor(a);
  const tokenB = await bearerFor(b);
  const scopeA = await fixtures(tokenA, 'Alpha Bays');
  const scopeB = await fixtures(tokenB, 'Beta Bays');
  const boxA = await createBox(tokenA, scopeA.org.id, scopeA.branch.id, 1);
  const boxB = await createBox(tokenB, scopeB.org.id, scopeB.branch.id, 1);
  const listA = washBoxListResponseSchema.parse(
    await (await apiCall(tokenA, boxPath(scopeA.org.id, scopeA.branch.id))).json(),
  );
  const listB = washBoxListResponseSchema.parse(
    await (await apiCall(tokenB, boxPath(scopeB.org.id, scopeB.branch.id))).json(),
  );
  expect(listA.washBoxes.map((box) => box.id)).toEqual([boxA.id]);
  expect(listB.washBoxes.map((box) => box.id)).toEqual([boxB.id]);
  for (const [method, body] of [
    ['GET', undefined],
    ['PATCH', { isActive: false }],
  ] as const) {
    const foreignOrg = await apiCall(
      tokenB,
      boxPath(scopeA.org.id, scopeA.branch.id, boxA.id),
      method,
      body,
    );
    const missingOrg = await apiCall(
      tokenB,
      boxPath(randomUUID(), scopeA.branch.id, boxA.id),
      method,
      body,
    );
    expect(foreignOrg.status).toBe(404);
    expect((await foreignOrg.json()).error).toEqual((await missingOrg.json()).error);
    const foreignBox = await apiCall(
      tokenB,
      boxPath(scopeB.org.id, scopeB.branch.id, boxA.id),
      method,
      body,
    );
    const missingBox = await apiCall(
      tokenB,
      boxPath(scopeB.org.id, scopeB.branch.id, randomUUID()),
      method,
      body,
    );
    expect(foreignBox.status).toBe(404);
    expect((await foreignBox.json()).error).toEqual((await missingBox.json()).error);
    const wrongBranch = await apiCall(
      tokenB,
      boxPath(scopeB.org.id, scopeA.branch.id, boxA.id),
      method,
      body,
    );
    expect(wrongBranch.status).toBe(404);
    expect((await wrongBranch.json()).error.code).toBe('BRANCH_NOT_FOUND');
  }
  for (const body of [
    { number: 2, userId: randomUUID() },
    { number: 2, isActive: false },
    { number: 2, branchId: scopeA.branch.id },
  ])
    expect(
      (await apiCall(tokenA, boxPath(scopeA.org.id, scopeA.branch.id), 'POST', body)).status,
    ).toBe(400);
  expect(
    (
      await apiCall(tokenA, boxPath(scopeA.org.id, scopeA.branch.id, boxA.id), 'PATCH', {
        number: 9,
        isActive: false,
      })
    ).status,
  ).toBe(400);
  const concurrent = await Promise.all([
    apiCall(tokenA, boxPath(scopeA.org.id, scopeA.branch.id), 'POST', { number: 3 }),
    apiCall(tokenA, boxPath(scopeA.org.id, scopeA.branch.id), 'POST', { number: 3 }),
  ]);
  expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409]);
  expect(
    washBoxListResponseSchema
      .parse(await (await apiCall(tokenA, boxPath(scopeA.org.id, scopeA.branch.id))).json())
      .washBoxes.filter((box) => box.number === 3),
  ).toHaveLength(1);
  expect(
    washBoxResponseSchema.parse(
      await (await apiCall(tokenA, boxPath(scopeA.org.id, scopeA.branch.id, boxA.id))).json(),
    ).washBox.isActive,
  ).toBe(true);
  const page = await context.newPage();
  await page.goto('/login');
  await login(page, b);
  await expectUser(page, b);
  await page.goto(pagePath(scopeB.org.id, scopeB.branch.id));
  await expect(page.getByRole('heading', { name: 'Box 1', exact: true })).toBeVisible();
  await privacy([page], [a, b]);
});

for (const operation of ['list', 'detail', 'state'] as const)
  test(
    '@wash-boxes account switch discards delayed old ' + operation,
    async ({ authUsers, context }) => {
      const privacy = monitorPrivacy(context);
      const a = await authUsers.create('a');
      const b = await authUsers.create('b');
      const tokenA = await bearerFor(a);
      const tokenB = await bearerFor(b);
      const scopeA = await fixtures(tokenA, 'Alpha Bays');
      const scopeB = await fixtures(tokenB, 'Beta Bays');
      const boxA = await createBox(tokenA, scopeA.org.id, scopeA.branch.id, 1);
      await createBox(tokenB, scopeB.org.id, scopeB.branch.id, 9);
      const receiver = await context.newPage();
      await receiver.goto('/login');
      await login(receiver, a);
      await expectUser(receiver, a);
      if (operation === 'state') {
        await receiver.goto(pagePath(scopeA.org.id, scopeA.branch.id, boxA.id));
        await expect(receiver.getByText('Active', { exact: true })).toBeVisible();
      }
      const entered = barrier();
      const release = barrier();
      const delayedPath =
        apiBase +
        boxPath(scopeA.org.id, scopeA.branch.id, operation === 'list' ? undefined : boxA.id);
      await receiver.route(delayedPath, async (route) => {
        if (operation === 'state' && route.request().method() !== 'PATCH') {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        entered.release();
        await release.promise;
        await route.fulfill({ response }).catch(() => undefined);
      });
      const navigation =
        operation === 'state'
          ? Promise.resolve()
          : receiver.goto(
              pagePath(
                scopeA.org.id,
                scopeA.branch.id,
                operation === 'detail' ? boxA.id : undefined,
              ),
            );
      if (operation === 'state') {
        await receiver.getByRole('button', { name: 'Disable Box 1' }).click();
        await receiver.getByRole('button', { name: 'Confirm deactivation' }).click();
      }
      await entered.promise;
      const syncEntered = barrier();
      const syncRelease = barrier();
      await receiver.route('**/api/v1/auth/refresh', async (route) => {
        syncEntered.release();
        await syncRelease.promise;
        await route.continue();
      });
      const sender = await context.newPage();
      await sender.goto('/login');
      await expectUser(sender, a);
      await sender.getByRole('button', { name: 'Sign in with another account' }).click();
      await login(sender, b);
      await expectUser(sender, b);
      await syncEntered.promise;
      await expect(receiver.getByText('Updating your session…')).toBeVisible();
      await expect(receiver.getByRole('heading', { name: 'Box 1', exact: true })).toHaveCount(0);
      syncRelease.release();
      await expect(receiver.getByText(/Signed in as/)).toBeVisible();
      release.release();
      await navigation;
      await receiver.goto(pagePath(scopeB.org.id, scopeB.branch.id));
      await expect(receiver.getByRole('heading', { name: 'Box 9', exact: true })).toBeVisible();
      await expect(receiver.getByText('Box activity saved.')).toHaveCount(0);
      const meA: { user: { id: string } } = await (await apiCall(tokenA, '/auth/me')).json();
      const queries = await inspectQueryState(receiver);
      expect(
        queries?.keys.some(
          (key) => String(key[0]).startsWith('wash-box') && key[1] === meA.user.id,
        ),
      ).toBe(false);
      await privacy([receiver, sender], [a, b]);
    },
  );

test('@wash-boxes branch navigation discards delayed committed state response', async ({
  authUsers,
  context,
}) => {
  const privacy = monitorPrivacy(context);
  const user = await authUsers.create('a');
  const token = await bearerFor(user);
  const first = await fixtures(token, 'First Bays');
  const secondResponse = await apiCall(token, `/organizations/${first.org.id}/branches`, 'POST', {
    name: 'Second Branch',
    city: 'Astana',
    addressLine: 'Address 22',
    timeZone: 'UTC',
  });
  expect(secondResponse.status).toBe(201);
  const second = {
    org: first.org,
    branch: createBranchResponseSchema.parse(await secondResponse.json()).branch,
  };
  const box = await createBox(token, first.org.id, first.branch.id, 1);
  await createBox(token, second.org.id, second.branch.id, 8);
  const page = await context.newPage();
  await page.goto('/login');
  await login(page, user);
  await expectUser(page, user);
  await page.goto(pagePath(first.org.id, first.branch.id));
  const entered = barrier();
  const release = barrier();
  await page.route(apiBase + boxPath(first.org.id, first.branch.id, box.id), async (route) => {
    const response = await route.fetch();
    entered.release();
    await release.promise;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.getByRole('button', { name: 'Disable Box 1' }).click();
  await page.getByRole('button', { name: 'Confirm deactivation' }).click();
  await entered.promise;
  // Real Next links preserve the provider while changing the resource scope.
  await page.getByRole('link', { name: 'Back to branch' }).click();
  await page.getByRole('link', { name: 'Back to branches' }).click();
  await page.getByRole('link', { name: 'Second Branch', exact: true }).click();
  await page.getByRole('link', { name: 'Manage wash boxes' }).click();
  await expect(page.getByRole('heading', { name: 'Box 8', exact: true })).toBeVisible();
  release.release();
  await expect(page.getByRole('heading', { name: 'Box 1', exact: true })).toHaveCount(0);
  await expect(page.getByText('Box activity saved.')).toHaveCount(0);
  expect(
    washBoxResponseSchema.parse(
      await (await apiCall(token, boxPath(first.org.id, first.branch.id, box.id))).json(),
    ).washBox.isActive,
  ).toBe(false);
  await privacy([page], [user]);
});
