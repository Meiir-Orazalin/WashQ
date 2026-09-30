import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import {
  branchDetailResponseSchema,
  branchListResponseSchema,
  createBranchResponseSchema,
  createOrganizationResponseSchema,
  loginResponseSchema,
  openingHoursResponseSchema,
  weekdays,
  type OpeningHoursEntry,
} from '@washqueue/contracts';
import {
  test,
  expect,
  login,
  expectUser,
  verifyScheduleRollback,
  type LiveAuthUser,
} from './auth-test';
const apiBase = 'http://127.0.0.1:4000/api/v1';
const input = {
  name: 'Branch',
  city: 'Astana',
  addressLine: 'Address 12',
  timeZone: 'Asia/Almaty',
};
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
async function createOrg(token: string, name: string) {
  const response = await apiCall(token, '/organizations', 'POST', { name });
  expect(response.status).toBe(201);
  return createOrganizationResponseSchema.parse(await response.json()).organization;
}
async function createBranchFixture(token: string, org: string, name: string) {
  const response = await apiCall(token, `/organizations/${org}/branches`, 'POST', {
    ...input,
    name,
  });
  expect(response.status).toBe(201);
  return createBranchResponseSchema.parse(await response.json()).branch;
}
const branchPath = (org: string, id?: string) =>
  `/organizations/${org}/branches${id ? '/' + id : ''}`;
const pagePath = (org: string, id?: string) => '/business' + branchPath(org, id);
const fullWeek = (offset = 0): OpeningHoursEntry[] =>
  weekdays.map((dayOfWeek) => ({
    dayOfWeek,
    status: 'OPEN',
    opensAt: offset ? '10:00' : '09:00',
    closesAt: offset ? '21:00' : '20:00',
    closesNextDay: false,
  }));
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

test('@branches creates a persisted branch and complete local week with mobile keyboard controls', async ({
  authUsers,
  context,
}) => {
  const privacy = monitorPrivacy(context);
  const user = await authUsers.create('a');
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await login(page, user);
  await expectUser(page, user);
  await page.getByRole('link', { name: 'Your organizations' }).click();
  await page.getByLabel('Organization name').fill('Branch Owner Wash');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.getByRole('link', { name: 'Branch Owner Wash' }).click();
  await page.waitForURL(/\/business\/organizations\/[a-f0-9-]+$/);
  await page.getByRole('link', { name: 'View branches' }).click();
  await expect(page.getByText('No branches yet. Create your first branch.')).toBeVisible();
  await page.getByRole('button', { name: 'Create branch' }).click();
  await expect(page.getByLabel('Branch name')).toHaveAttribute('aria-invalid', 'true');
  for (const [label, value] of [
    ['Branch name', ' Ｓaryarka  Branch '],
    ['City', ' Astana '],
    ['Address', '12 Saryarka Avenue'],
    ['IANA time zone', 'Asia/Almaty'],
  ] as const)
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Create branch' }).click();
  await expect(page.getByText('Branch created.')).toBeVisible();
  await page.getByRole('link', { name: 'Saryarka Branch' }).click();
  await page.waitForURL(/\/branches\/[a-f0-9-]+$/);
  await expect(page.getByText('Opening hours have not been configured.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Saryarka Branch' })).toBeVisible();
  for (const day of weekdays.slice(0, 5)) {
    await page.getByLabel(day + ' status', { exact: true }).selectOption('OPEN');
    await page.getByLabel(day + ' opening time', { exact: true }).fill('09:00');
    await page.getByLabel(day + ' closing time', { exact: true }).fill('20:00');
  }
  await page.getByLabel('FRIDAY opening time', { exact: true }).fill('22:00');
  await page.getByLabel('FRIDAY closing time', { exact: true }).fill('02:00');
  await page.getByLabel('FRIDAY closes next day', { exact: true }).check();
  await page.getByLabel('SATURDAY status', { exact: true }).selectOption('OPEN_24_HOURS');
  await page.getByLabel('SUNDAY status', { exact: true }).selectOption('CLOSED');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && response.url().endsWith('/opening-hours'),
  );
  await page.getByRole('button', { name: 'Save opening hours' }).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const parsed = openingHoursResponseSchema.parse(await response.json());
  expect(parsed.openingHours.map((entry) => entry.dayOfWeek)).toEqual(weekdays);
  expect(parsed.openingHours[4]).toMatchObject({
    opensAt: '22:00',
    closesAt: '02:00',
    closesNextDay: true,
  });
  await expect(page.getByText('Opening hours saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('FRIDAY: 22:00–02:00 (next day)', { exact: true })).toBeVisible();
  await expect(page.getByText('SATURDAY: Open 24 hours', { exact: true })).toBeVisible();
  await expect(page.getByText('SUNDAY: Closed', { exact: true })).toBeVisible();
  await expect(page.getByLabel('MONDAY opening time', { exact: true })).toHaveValue('09:00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Save opening hours' }).focus();
  await expect(page.getByRole('button', { name: 'Save opening hours' })).toBeFocused();
  await privacy([page], [user]);
});
test('@branches preserves local time in another browser zone and enforces private owner/org scope', async ({
  authUsers,
  browser,
}) => {
  const a = await authUsers.create('a');
  const b = await authUsers.create('b');
  const tokenA = await bearerFor(a);
  const tokenB = await bearerFor(b);
  const orgA = await createOrg(tokenA, 'Alpha Wash');
  const orgB = await createOrg(tokenB, 'Beta Wash');
  const branchA = await createBranchFixture(tokenA, orgA.id, 'Alpha Branch');
  await createBranchFixture(tokenB, orgB.id, 'Beta Branch');
  const replace = await apiCall(tokenA, branchPath(orgA.id, branchA.id) + '/opening-hours', 'PUT', {
    openingHours: fullWeek(),
  });
  expect(replace.status).toBe(200);
  for (const suffix of [
    '/branches',
    '/branches/' + branchA.id,
    '/branches/' + branchA.id + '/opening-hours',
  ]) {
    const method = suffix.endsWith('opening-hours') ? 'PUT' : 'GET';
    const body = method === 'PUT' ? { openingHours: fullWeek(1) } : undefined;
    const foreign = await apiCall(tokenB, '/organizations/' + orgA.id + suffix, method, body);
    const missing = await apiCall(tokenB, '/organizations/' + randomUUID() + suffix, method, body);
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    const f = await foreign.json();
    const m = await missing.json();
    expect(f.error).toEqual(m.error);
    expect(f.error.code).toBe('ORGANIZATION_NOT_FOUND');
  }
  for (const method of ['GET', 'PUT']) {
    const suffix = method === 'PUT' ? '/opening-hours' : '';
    const foreign = await apiCall(
      tokenB,
      branchPath(orgB.id, branchA.id) + suffix,
      method,
      method === 'PUT' ? { openingHours: fullWeek() } : undefined,
    );
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error).toEqual({
      code: 'BRANCH_NOT_FOUND',
      message: 'The branch was not found',
    });
  }
  const list = await apiCall(tokenB, branchPath(orgB.id));
  expect(branchListResponseSchema.parse(await list.json()).branches.map((row) => row.name)).toEqual(
    ['Beta Branch'],
  );
  const foreignContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:3000',
    timezoneId: 'America/New_York',
  });
  try {
    const page = await foreignContext.newPage();
    await page.goto('/login');
    await login(page, a);
    await expectUser(page, a);
    await page.goto(pagePath(orgA.id, branchA.id));
    await expect(page.getByLabel('MONDAY opening time', { exact: true })).toHaveValue('09:00');
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
      'America/New_York',
    );
    await page.reload();
    await expect(page.getByText('MONDAY: 09:00–20:00', { exact: true })).toBeVisible();
  } finally {
    await foreignContext.close();
  }
});
test('@branches rolls back a failed replacement and serializes concurrent full weeks', async ({
  authUsers,
}) => {
  const user = await authUsers.create('a');
  const token = await bearerFor(user);
  const org = await createOrg(token, 'Atomic Wash');
  const branch = await createBranchFixture(token, org.id, 'Atomic Branch');
  const path = branchPath(org.id, branch.id) + '/opening-hours';
  expect((await apiCall(token, path, 'PUT', { openingHours: fullWeek() })).status).toBe(200);
  expect(await verifyScheduleRollback(user.email, org.id, branch.id)).toEqual({
    failed: true,
    previousSchedulePreserved: true,
    days: 7,
  });
  const a = fullWeek();
  const b = fullWeek(1);
  const results = await Promise.all([
    apiCall(token, path, 'PUT', { openingHours: a }),
    apiCall(token, path, 'PUT', { openingHours: b }),
  ]);
  expect(results.map((response) => response.status)).toEqual([200, 200]);
  for (const response of results)
    expect(openingHoursResponseSchema.safeParse(await response.json()).success).toBe(true);
  const detail = branchDetailResponseSchema.parse(
    await (await apiCall(token, branchPath(org.id, branch.id))).json(),
  );
  expect(
    [JSON.stringify(a), JSON.stringify(b)].includes(JSON.stringify(detail.branch.openingHours)),
  ).toBe(true);
});
for (const operation of ['list', 'detail', 'schedule'] as const)
  test(
    '@branches cross-tab identity switch discards delayed ' + operation,
    async ({ authUsers, context }) => {
      const userA = await authUsers.create('a');
      const userB = await authUsers.create('b');
      const tokenA = await bearerFor(userA);
      const tokenB = await bearerFor(userB);
      const orgA = await createOrg(tokenA, 'Alpha Wash');
      const orgB = await createOrg(tokenB, 'Beta Wash');
      const branchA = await createBranchFixture(tokenA, orgA.id, 'Alpha Branch');
      const branchB = await createBranchFixture(tokenB, orgB.id, 'Beta Branch');
      const sender = await context.newPage();
      await sender.goto('/login');
      await login(sender, userA);
      await expectUser(sender, userA);
      const receiver = await context.newPage();
      const route = pagePath(orgA.id, operation === 'list' ? undefined : branchA.id);
      await receiver.goto(route);
      await expect(
        receiver.getByRole(operation === 'list' ? 'link' : 'heading', { name: 'Alpha Branch' }),
      ).toBeVisible();
      const pending = barrier();
      const started = barrier();
      const pattern =
        apiBase +
        branchPath(orgA.id, operation === 'list' ? undefined : branchA.id) +
        (operation === 'schedule' ? '/opening-hours' : '');
      let delayed = false;
      await receiver.route(pattern, async (route) => {
        if (delayed) {
          await route.continue();
          return;
        }
        delayed = true;
        const response = await route.fetch();
        started.release();
        await pending.promise;
        try {
          await route.fulfill({ response });
        } catch {
          /* Identity cleanup can abort old transport. */
        }
      });
      if (operation === 'schedule')
        await receiver.getByRole('button', { name: 'Save opening hours' }).click();
      else await receiver.reload();
      await started.promise;
      const synchronize = barrier();
      const synchronizing = barrier();
      await receiver.route('**/api/v1/auth/refresh', async (route) => {
        synchronizing.release();
        await synchronize.promise;
        await route.continue();
      });
      await sender.getByRole('button', { name: 'Sign in with another account' }).click();
      await login(sender, userB);
      await expectUser(sender, userB);
      await synchronizing.promise;
      await expect(receiver.getByText('Updating your session…')).toBeVisible();
      await expect(receiver.getByText('Alpha Branch', { exact: true })).toHaveCount(0);
      await expect(receiver.getByRole('form', { name: 'Weekly opening hours' })).toHaveCount(0);
      await expect(receiver.getByLabel('Branch name', { exact: true })).toHaveCount(0);
      synchronize.release();
      await expect(receiver.getByText('This organization is not available.')).toBeVisible();
      pending.release();
      await receiver.goto(pagePath(orgB.id, branchB.id));
      await expect(receiver.getByRole('heading', { name: 'Beta Branch' })).toBeVisible();
      await expect(receiver.getByText('Alpha Branch', { exact: true })).toHaveCount(0);
      await expect(receiver.getByText('Opening hours saved.')).toHaveCount(0);
      const cache = await inspectQueryState(receiver);
      expect(cache !== null && !cache.serialized.includes('Alpha Branch')).toBe(true);
      expect(
        cache?.keys.some(
          (key) => key[0] === 'branch' && key[2] === orgB.id && key[3] === branchB.id,
        ),
      ).toBe(true);
    },
  );
