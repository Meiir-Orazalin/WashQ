import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import {
  apiErrorResponseSchema,
  createVehicleResponseSchema,
  loginResponseSchema,
  updateVehicleResponseSchema,
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
  const parsed = loginResponseSchema.safeParse(await response.json());
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error('Invalid login response');
  return parsed.data.accessToken;
}
async function vehicleRequest(token: string, method: string, id = '', body?: unknown) {
  return fetch(`${apiBase}/vehicles${id ? `/${id}` : ''}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function create(token: string, values: unknown = input) {
  const response = await vehicleRequest(token, 'POST', '', values);
  expect(response.status).toBe(201);
  return createVehicleResponseSchema.parse(await response.json()).vehicle;
}
async function list(token: string) {
  const response = await vehicleRequest(token, 'GET');
  expect(response.status).toBe(200);
  return vehicleListResponseSchema.parse(await response.json()).vehicles;
}
async function errorPayload(response: Response) {
  return apiErrorResponseSchema.parse(await response.json()).error;
}

/** Credentials remain transient in the runner; assertions print only booleans. */
function privacyMonitor(context: BrowserContext) {
  const tokens: string[] = [];
  const logs: string[] = [];
  const pending: Promise<void>[] = [];
  const cookiesSent: boolean[] = [];
  context.on('page', (page) => page.on('console', (message) => logs.push(message.text())));
  context.on('response', (response) => {
    if (
      /\/auth\/(login|refresh)$/.test(new URL(response.url()).pathname) &&
      response.status() === 200
    ) {
      pending.push(
        (async () => {
          const body: unknown = await response.json();
          if (
            typeof body === 'object' &&
            body !== null &&
            'accessToken' in body &&
            typeof body.accessToken === 'string'
          )
            tokens.push(body.accessToken);
        })(),
      );
    }
  });
  context.on('request', (request) => {
    if (/\/api\/v1\/vehicles(?:\/[^/]+)?$/.test(new URL(request.url()).pathname))
      pending.push(
        (async () => {
          cookiesSent.push(Boolean((await request.allHeaders()).cookie));
        })(),
      );
  });
  return async (pages: Page[], users: LiveAuthUser[]) => {
    await Promise.all(pending);
    const secrets = [
      ...tokens,
      ...(await context.cookies()).map(({ value }) => value),
      ...users.map(({ password }) => password),
      process.env.ACCESS_TOKEN_SIGNING_SECRET,
    ].filter((value): value is string => Boolean(value));
    for (const page of pages) {
      const state = await page.evaluate(async () =>
        JSON.stringify({
          markup: document.documentElement.innerHTML,
          local: { ...localStorage },
          session: { ...sessionStorage },
          cookie: document.cookie,
          indexed: await indexedDB.databases(),
        }),
      );
      expect(secrets.some((secret) => state.includes(secret))).toBe(false);
      expect(
        await page.evaluate(
          async () =>
            localStorage.length === 0 &&
            sessionStorage.length === 0 &&
            (await indexedDB.databases()).length === 0,
        ),
      ).toBe(true);
    }
    expect(secrets.some((secret) => logs.join('\n').includes(secret))).toBe(false);
    expect(cookiesSent.some(Boolean)).toBe(false);
  };
}

test('@vehicles edits every field, persists clears, and deletes with keyboard-accessible mobile controls', async ({
  authUsers,
  context,
}) => {
  const privacy = privacyMonitor(context);
  const user = await authUsers.create('a');
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await login(page, user);
  await expectUser(page, user);
  await page.getByRole('link', { name: 'Your vehicles' }).click();
  for (const [label, value] of [
    ['Make', 'Toyota'],
    ['Model', 'Camry'],
    ['Plate number', '123 ABC 01'],
    ['Production year (optional)', '2024'],
    ['Color (optional)', 'Black'],
  ] as const)
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: 'Add vehicle' }).click();
  const item = page.getByRole('listitem');
  await expect(item).toContainText('123ABC01');
  await item.getByRole('button', { name: 'Edit', exact: true }).focus();
  await page.keyboard.press('Enter');
  const form = page.getByRole('form', { name: 'Edit vehicle' });
  await expect(form.getByLabel('Make', { exact: true })).toBeFocused();
  for (const [label, value] of [
    ['Make', ' Lexus '],
    ['Model', ' ES  Hybrid '],
    ['Plate number', ' ４５６－ｄｅｆ－０２ '],
    ['Production year (optional)', '2025'],
    ['Color (optional)', ' Pearl  White '],
  ] as const)
    await form.getByLabel(label, { exact: true }).fill(value);
  const updated = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.url().includes('/vehicles/'),
  );
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  const response = await updated;
  expect(response.status()).toBe(200);
  const vehicle = updateVehicleResponseSchema.parse(await response.json()).vehicle;
  expect(vehicle).toMatchObject({
    make: 'Lexus',
    model: 'ES Hybrid',
    plateNumber: '456DEF02',
    productionYear: 2025,
    color: 'Pearl White',
  });
  await expect(form).not.toBeVisible();
  await expect(item.getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
  await page.reload();
  await expect(item).toContainText('Lexus ES Hybrid');
  await expect(item).toContainText('456DEF02');
  await expect(item).toContainText('Year: 2025');
  await expect(item).toContainText('Color: Pearl White');
  await item.getByRole('button', { name: 'Edit', exact: true }).click();
  await form.getByLabel('Production year (optional)').fill('');
  await form.getByLabel('Color (optional)').fill('');
  const cleared = page.waitForResponse((result) => result.request().method() === 'PATCH');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  const clearedVehicle = updateVehicleResponseSchema.parse(await (await cleared).json()).vehicle;
  expect(clearedVehicle.productionYear).toBeNull();
  expect(clearedVehicle.color).toBeNull();
  await expect(form).not.toBeVisible();
  await page.reload();
  await expect(item).toContainText('456DEF02');
  await expect(item).not.toContainText('Year:');
  await expect(item).not.toContainText('Color:');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await privacy([page], [user]);
  await item.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Delete this vehicle? This cannot be undone.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Delete', exact: true }).click();
  const deleted = page.waitForResponse((result) => result.request().method() === 'DELETE');
  await expect(page.getByRole('button', { name: 'Confirm delete' })).toBeFocused();
  await page.keyboard.press('Enter');
  const deleteResponse = await deleted;
  expect(deleteResponse.status()).toBe(204);
  // Browser protocols retain no resource body for 204; assert actual transfer
  // size instead. The real HTTP suite independently checks zero response bytes.
  expect((await deleteResponse.request().sizes()).responseBodySize).toBe(0);
  await expect(page.getByText('Vehicle deleted.')).toBeVisible();
  await expect(item).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your vehicles' })).toBeFocused();
  await page.reload();
  await expect(page.getByText('No vehicles yet. Add your first vehicle.')).toBeVisible();
  const repeated = await vehicleRequest(await bearerFor(user), 'DELETE', vehicle.id);
  expect(repeated.status).toBe(404);
  expect(await errorPayload(repeated)).toEqual({
    code: 'VEHICLE_NOT_FOUND',
    message: 'The vehicle was not found',
  });
  expect(await inspectVehicleCount(user.email)).toEqual({ vehicles: 0 });
});

test('@vehicles duplicate edits show an accessible conflict and preserve both original rows', async ({
  authUsers,
  context,
}) => {
  const user = await authUsers.create('a');
  const token = await bearerFor(user);
  const first = await create(token);
  const second = await create(token, { ...input, model: 'Corolla', plateNumber: 'OTHER01' });
  const page = await context.newPage();
  await page.goto('/login');
  await login(page, user);
  await expectUser(page, user);
  await page.getByRole('link', { name: 'Your vehicles' }).click();
  await page
    .getByRole('listitem')
    .filter({ hasText: 'OTHER01' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const form = page.getByRole('form', { name: 'Edit vehicle' });
  await form.getByLabel('Plate number').fill('123-abc-01');
  const result = page.waitForResponse((response) => response.request().method() === 'PATCH');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await result).status()).toBe(409);
  await expect(form.getByRole('alert')).toHaveText(
    'You already have a vehicle with this plate number.',
  );
  expect(await list(token)).toEqual(expect.arrayContaining([first, second]));
  expect(await inspectVehicleCount(user.email)).toEqual({ vehicles: 2 });
});

test('@vehicles foreign and missing mutations are indistinguishable and concurrent updates preserve uniqueness', async ({
  authUsers,
}) => {
  const [a, b] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
  const [tokenA, tokenB] = await Promise.all([bearerFor(a), bearerFor(b)]);
  const first = await create(tokenA);
  const second = await create(tokenA, { ...input, plateNumber: 'SECOND01' });
  const foreign = await create(tokenB, { ...input, plateNumber: 'FOREIGN01' });
  for (const method of ['PATCH', 'DELETE']) {
    for (const id of [first.id, randomUUID()]) {
      const response = await vehicleRequest(
        tokenB,
        method,
        id,
        method === 'PATCH' ? { model: 'Unauthorized' } : undefined,
      );
      expect(response.status).toBe(404);
      expect(await errorPayload(response)).toEqual({
        code: 'VEHICLE_NOT_FOUND',
        message: 'The vehicle was not found',
      });
    }
  }
  expect(await list(tokenA)).toEqual(expect.arrayContaining([first, second]));
  const samePlate = await vehicleRequest(tokenB, 'PATCH', foreign.id, {
    plateNumber: '123-abc-01',
  });
  expect(samePlate.status).toBe(200);
  const foreignUpdated = updateVehicleResponseSchema.parse(await samePlate.json()).vehicle;
  for (const field of ['ownerUserId', 'userId', 'id'])
    expect(
      (await vehicleRequest(tokenA, 'PATCH', first.id, { model: 'Spoofed', [field]: foreign.id }))
        .status,
    ).toBe(400);
  const updates = await Promise.all([
    vehicleRequest(tokenA, 'PATCH', first.id, { plateNumber: 'RACE 01' }),
    vehicleRequest(tokenA, 'PATCH', second.id, { plateNumber: 'race-01' }),
  ]);
  expect(updates.map(({ status }) => status).sort()).toEqual([200, 409]);
  const after = await list(tokenA);
  expect(after.filter(({ plateNumber }) => plateNumber === 'RACE01')).toHaveLength(1);
  expect(after).toHaveLength(2);
  expect(await list(tokenB)).toEqual([foreignUpdated]);
  const deletes = await Promise.all([
    vehicleRequest(tokenA, 'DELETE', first.id),
    vehicleRequest(tokenA, 'DELETE', first.id),
  ]);
  expect(deletes.map(({ status }) => status).sort()).toEqual([204, 404]);
  expect(await inspectVehicleCount(a.email)).toEqual({ vehicles: 1 });
  expect(await inspectVehicleCount(b.email)).toEqual({ vehicles: 1 });
  expect(await list(tokenB)).toEqual([foreignUpdated]);
});

for (const method of ['PATCH', 'DELETE'] as const) {
  test(`@vehicles cross-tab identity switch discards a delayed ${method} completion and closes old controls`, async ({
    authUsers,
    context,
  }) => {
    const privacy = privacyMonitor(context);
    const [a, b] = await Promise.all([authUsers.create('a'), authUsers.create('b')]);
    const [tokenA, tokenB] = await Promise.all([bearerFor(a), bearerFor(b)]);
    const vehicleA = await create(tokenA, { ...input, make: 'Alpha Make' });
    await create(tokenB, { ...input, make: 'Beta Make' });
    const sender = await context.newPage();
    await sender.goto('/login');
    await login(sender, a);
    await expectUser(sender, a);
    await sender.getByRole('link', { name: 'Your vehicles' }).click();
    const receiver = await context.newPage();
    await receiver.goto('/vehicles');
    for (const page of [sender, receiver])
      await expect(page.getByRole('listitem')).toContainText('Alpha Make');
    const started = barrier();
    const releaseMutation = barrier();
    await receiver.route(`**/api/v1/vehicles/${vehicleA.id}`, async (route) => {
      if (route.request().method() !== method) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      expect(response.status()).toBe(method === 'PATCH' ? 200 : 204);
      started.release();
      await releaseMutation.promise;
      // A discarded request is deliberately aborted by the feature boundary.
      await route.fulfill({ response }).catch(() => undefined);
    });
    await receiver
      .getByRole('button', { name: method === 'PATCH' ? 'Edit' : 'Delete', exact: true })
      .click();
    if (method === 'PATCH') {
      const form = receiver.getByRole('form', { name: 'Edit vehicle' });
      await form.getByLabel('Model', { exact: true }).fill('Delayed Alpha');
      await form.getByRole('button', { name: 'Save', exact: true }).click();
    } else await receiver.getByRole('button', { name: 'Confirm delete' }).click();
    await started.promise;
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
    await expect(receiver.getByText('Alpha Make Camry')).not.toBeVisible();
    await expect(receiver.getByRole('form', { name: 'Edit vehicle' })).not.toBeVisible();
    await expect(receiver.getByRole('button', { name: 'Confirm delete' })).not.toBeVisible();
    releaseSync.release();
    await expect(receiver.getByText(b.email)).toBeVisible();
    await expect(receiver.getByRole('listitem')).toContainText('Beta Make');
    await receiver.evaluate(() => {
      const state = window as Window & { __staleVehicleMutationVisible?: boolean };
      state.__staleVehicleMutationVisible = false;
      new MutationObserver(() => {
        if (
          /Alpha Make|Delayed Alpha|Vehicle updated\.|Vehicle deleted\.|no longer available/.test(
            document.body.textContent ?? '',
          )
        )
          state.__staleVehicleMutationVisible = true;
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    releaseMutation.release();
    await receiver.unrouteAll({ behavior: 'wait' });
    await sender.getByRole('link', { name: 'Your vehicles' }).click();
    for (const page of [sender, receiver]) {
      await expect(page.getByRole('listitem')).toContainText('Beta Make');
      await expect(page.getByRole('listitem')).not.toContainText('Alpha Make');
      await expect(
        page.getByText(/Vehicle updated\.|Vehicle deleted\.|no longer available/),
      ).not.toBeVisible();
    }
    expect(
      await receiver.evaluate(
        () =>
          (window as Window & { __staleVehicleMutationVisible?: boolean })
            .__staleVehicleMutationVisible,
      ),
    ).toBe(false);
    await privacy([sender, receiver], [a, b]);
    await sender.getByRole('button', { name: 'Sign out' }).click();
    for (const page of [sender, receiver]) {
      await expect(page.getByText('Sign in to add and view your vehicles.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit', exact: true })).not.toBeVisible();
    }
  });
}
