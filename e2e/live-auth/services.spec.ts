import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import {
  loginResponseSchema,
  createOrganizationResponseSchema,
  createBranchResponseSchema,
  branchServiceResponseSchema,
  branchServiceListResponseSchema,
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
const servicePath = (org: string, branch: string, box?: string) =>
  `/organizations/${org}/branches/${branch}/services${box ? '/' + box : ''}`;
const pagePath = (org: string, branch: string, box?: string) =>
  '/business' + servicePath(org, branch, box);
async function createService(token: string, org: string, branch: string, name: string) {
  const response = await apiCall(token, servicePath(org, branch), 'POST', {
    name,
    durationMinutes: 30,
    priceMinor: 500000,
    currency: 'KZT',
  });
  expect(response.status).toBe(201);
  return branchServiceResponseSchema.parse(await response.json()).service;
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

test('@services exact KZT creation, edit, clear, state and persistence with mobile keyboard privacy', async ({
  authUsers,
  context,
}) => {
  const privacy = monitorPrivacy(context);
  const user = await authUsers.create('a');
  const token = await bearerFor(user);
  const { org, branch } = await fixtures(token, 'Service Owner');
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await login(page, user);
  await expectUser(page, user);
  await page.goto('/business/organizations/' + org.id + '/branches/' + branch.id);
  await page.getByRole('link', { name: 'Manage services' }).click();
  await expect(page.getByText('No services saved for this branch yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Create service' }).click();
  await expect(page.getByLabel('Price (KZT)')).toHaveAttribute('aria-invalid', 'true');
  for (const [label, value] of [
    ['Service name', 'Exterior wash'],
    ['Description (optional)', 'Plain text'],
    ['Duration (minutes)', '30'],
    ['Price (KZT)', '5000'],
  ] as const)
    await page.getByLabel(label).fill(value);
  await page.getByLabel('Price (KZT)').press('Enter');
  await expect(page.getByRole('heading', { name: 'Exterior wash', exact: true })).toBeVisible();
  await expect(page.getByLabel('Price (KZT)')).toHaveValue('');
  const list = branchServiceListResponseSchema.parse(
    await (await apiCall(token, servicePath(org.id, branch.id))).json(),
  );
  expect(list.services[0]?.priceMinor).toBe(500000);
  expect(list.services[0]?.durationMinutes).toBe(30);
  await page.reload();
  await expect(page.getByText(/KZT.*5,000.00/)).toBeVisible();
  await page.getByRole('link', { name: 'View Exterior wash' }).click();
  await page.getByRole('button', { name: 'Edit service', exact: true }).click();
  await expect(page.getByLabel('Service name')).toBeFocused();
  await expect(page.getByLabel('Price (KZT)')).toHaveValue('5000.00');
  await page.getByLabel('Price (KZT)').fill('5000,50');
  await page.getByLabel('Duration (minutes)').fill('45');
  await page.getByLabel('Description (optional)').fill('Updated description');
  await page.getByRole('button', { name: 'Save service' }).press('Enter');
  await expect(page.getByText('Service saved.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit service', exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByText(/KZT.*5,000.50.*45 minutes/)).toBeVisible();
  await page.getByRole('button', { name: 'Edit service', exact: true }).click();
  await expect(page.getByLabel('Price (KZT)')).toHaveValue('5000.50');
  await page.getByLabel('Description (optional)').fill('');
  await page.getByRole('button', { name: 'Save service' }).click();
  await expect(page.getByText('Service saved.', { exact: true })).toBeVisible();
  const id = list.services[0]?.id;
  if (!id) throw new Error('Missing service');
  const current = branchServiceResponseSchema.parse(
    await (await apiCall(token, servicePath(org.id, branch.id, id))).json(),
  ).service;
  expect([current.priceMinor, current.durationMinutes, current.description]).toEqual([
    500050,
    45,
    null,
  ]);
  let patches = 0;
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes('/services/')) patches++;
  });
  await page.getByRole('button', { name: 'Deactivate service' }).click();
  await expect(page.getByRole('button', { name: 'Confirm deactivation' })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel' }).press('Enter');
  expect(patches).toBe(0);
  await page.getByRole('button', { name: 'Deactivate service' }).click();
  await page.getByRole('button', { name: 'Confirm deactivation' }).press('Enter');
  await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reactivate service' }).press('Enter');
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await privacy([page], [user]);
});

test('@services owner/wrong-parent privacy, immutable input and atomic concurrent patches', async ({
  authUsers,
  context,
}) => {
  const privacy = monitorPrivacy(context);
  const a = await authUsers.create('a');
  const b = await authUsers.create('b');
  const ta = await bearerFor(a),
    tb = await bearerFor(b);
  const sa = await fixtures(ta, 'Alpha Services'),
    sb = await fixtures(tb, 'Beta Services');
  const serviceA = await createService(ta, sa.org.id, sa.branch.id, 'Alpha wash');
  const serviceB = await createService(tb, sb.org.id, sb.branch.id, 'Beta wash');
  for (const method of ['GET', 'PATCH']) {
    const body = method === 'PATCH' ? { priceMinor: 1 } : undefined;
    const foreign = await apiCall(
      tb,
      servicePath(sa.org.id, sa.branch.id, serviceA.id),
      method,
      body,
    );
    const missing = await apiCall(
      tb,
      servicePath(randomUUID(), sa.branch.id, serviceA.id),
      method,
      body,
    );
    expect([foreign.status, missing.status]).toEqual([404, 404]);
    expect((await foreign.json()).error).toEqual((await missing.json()).error);
    const wrong = await apiCall(
      tb,
      servicePath(sb.org.id, sb.branch.id, serviceA.id),
      method,
      body,
    );
    const absent = await apiCall(
      tb,
      servicePath(sb.org.id, sb.branch.id, randomUUID()),
      method,
      body,
    );
    expect([wrong.status, absent.status]).toEqual([404, 404]);
    expect((await wrong.json()).error).toEqual({
      code: 'SERVICE_NOT_FOUND',
      message: 'The service was not found',
    });
    expect((await absent.json()).error).toEqual({
      code: 'SERVICE_NOT_FOUND',
      message: 'The service was not found',
    });
  }
  const wrongBranch = await apiCall(tb, servicePath(sb.org.id, sa.branch.id, serviceA.id));
  const missingBranch = await apiCall(tb, servicePath(sb.org.id, randomUUID(), serviceA.id));
  expect((await wrongBranch.json()).error).toEqual((await missingBranch.json()).error);
  for (const body of [
    { currency: 'USD' },
    { branchId: sb.branch.id },
    { userId: randomUUID() },
    { id: serviceA.id },
    { isActive: 'false' },
    {},
  ])
    expect(
      (await apiCall(ta, servicePath(sa.org.id, sa.branch.id, serviceA.id), 'PATCH', body)).status,
    ).toBe(400);
  expect(
    branchServiceResponseSchema.parse(
      await (await apiCall(ta, servicePath(sa.org.id, sa.branch.id, serviceA.id))).json(),
    ).service,
  ).toEqual(serviceA);
  const responses = await Promise.all([
    apiCall(ta, servicePath(sa.org.id, sa.branch.id, serviceA.id), 'PATCH', { priceMinor: 101 }),
    apiCall(ta, servicePath(sa.org.id, sa.branch.id, serviceA.id), 'PATCH', {
      durationMinutes: 91,
    }),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  const final = branchServiceResponseSchema.parse(
    await (await apiCall(ta, servicePath(sa.org.id, sa.branch.id, serviceA.id))).json(),
  ).service;
  expect([final.priceMinor, final.durationMinutes]).toEqual([101, 91]);
  expect(
    branchServiceResponseSchema.parse(
      await (await apiCall(tb, servicePath(sb.org.id, sb.branch.id, serviceB.id))).json(),
    ).service,
  ).toEqual(serviceB);
  const page = await context.newPage();
  await page.goto('/login');
  await login(page, b);
  await expectUser(page, b);
  await page.goto(pagePath(sb.org.id, sb.branch.id));
  await expect(page.getByRole('heading', { name: 'Beta wash', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alpha wash', exact: true })).toHaveCount(0);
  await privacy([page], [a, b]);
});
for (const operation of ['list', 'detail', 'state'] as const)
  test(
    '@services account switch discards delayed old ' + operation,
    async ({ authUsers, context }) => {
      const privacy = monitorPrivacy(context);
      const a = await authUsers.create('a');
      const b = await authUsers.create('b');
      const tokenA = await bearerFor(a);
      const tokenB = await bearerFor(b);
      const scopeA = await fixtures(tokenA, 'Alpha Services');
      const scopeB = await fixtures(tokenB, 'Beta Services');
      const boxA = await createService(tokenA, scopeA.org.id, scopeA.branch.id, 'Alpha wash');
      await createService(tokenB, scopeB.org.id, scopeB.branch.id, 'Beta wash');
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
        servicePath(scopeA.org.id, scopeA.branch.id, operation === 'list' ? undefined : boxA.id);
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
        await receiver.getByRole('button', { name: 'Deactivate service' }).click();
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
      await expect(receiver.getByRole('heading', { name: 'Alpha wash', exact: true })).toHaveCount(
        0,
      );
      syncRelease.release();
      await expect(receiver.getByText(/Signed in as/)).toBeVisible();
      release.release();
      await navigation;
      await receiver.goto(pagePath(scopeB.org.id, scopeB.branch.id));
      await expect(receiver.getByRole('heading', { name: 'Beta wash', exact: true })).toBeVisible();
      await expect(receiver.getByText('Service activity saved.')).toHaveCount(0);
      const meA: { user: { id: string } } = await (await apiCall(tokenA, '/auth/me')).json();
      const queries = await inspectQueryState(receiver);
      expect(
        queries?.keys.some(
          (key) => String(key[0]).startsWith('branch-service') && key[1] === meA.user.id,
        ),
      ).toBe(false);
      await privacy([receiver, sender], [a, b]);
    },
  );

for (const operation of ['list', 'detail', 'patch'] as const)
  test(
    '@services branch navigation discards delayed ' + operation,
    async ({ authUsers, context }) => {
      const privacy = monitorPrivacy(context);
      const user = await authUsers.create('a');
      const token = await bearerFor(user);
      const first = await fixtures(token, 'First Services');
      const secondResponse = await apiCall(
        token,
        `/organizations/${first.org.id}/branches`,
        'POST',
        { name: 'Second Branch', city: 'Astana', addressLine: 'Address 22', timeZone: 'UTC' },
      );
      expect(secondResponse.status).toBe(201);
      const second = createBranchResponseSchema.parse(await secondResponse.json()).branch;
      const service = await createService(token, first.org.id, first.branch.id, 'Alpha wash');
      await createService(token, first.org.id, second.id, 'Second branch wash');
      const page = await context.newPage();
      await page.goto('/login');
      await login(page, user);
      await expectUser(page, user);
      await page.goto(
        operation === 'list'
          ? '/business/organizations/' + first.org.id + '/branches/' + first.branch.id
          : pagePath(first.org.id, first.branch.id, operation === 'patch' ? service.id : undefined),
      );
      if (operation === 'patch')
        await expect(page.getByRole('button', { name: 'Deactivate service' })).toBeVisible();
      else if (operation === 'detail')
        await expect(page.getByRole('link', { name: 'View Alpha wash' })).toBeVisible();
      const entered = barrier(),
        release = barrier();
      await page.route(
        apiBase +
          servicePath(first.org.id, first.branch.id, operation === 'list' ? undefined : service.id),
        async (route) => {
          if (operation === 'patch' && route.request().method() !== 'PATCH') {
            await route.continue();
            return;
          }
          const response = await route.fetch();
          entered.release();
          await release.promise;
          await route.fulfill({ response }).catch(() => undefined);
        },
      );
      if (operation === 'patch') {
        await page.getByRole('button', { name: 'Deactivate service' }).click();
        await page.getByRole('button', { name: 'Confirm deactivation' }).click();
      } else
        await page
          .getByRole('link', { name: operation === 'list' ? 'Manage services' : 'View Alpha wash' })
          .click();
      await entered.promise;
      if (operation !== 'list') await page.getByRole('link', { name: 'Back to services' }).click();
      await page.getByRole('link', { name: 'Back to branch', exact: true }).click();
      await page.getByRole('link', { name: 'Back to branches', exact: true }).click();
      await page.getByRole('link', { name: 'Second Branch', exact: true }).click();
      await page.getByRole('link', { name: 'Manage services' }).click();
      await expect(
        page.getByRole('heading', { name: 'Second branch wash', exact: true }),
      ).toBeVisible();
      release.release();
      await expect(page.getByRole('heading', { name: 'Alpha wash', exact: true })).toHaveCount(0);
      await expect(page.getByText('Service activity saved.', { exact: true })).toHaveCount(0);
      await privacy([page], [user]);
    },
  );
