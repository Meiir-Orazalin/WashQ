import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from '@playwright/test';

const execFileAsync = promisify(execFile);
const repositoryRoot = new URL('../..', import.meta.url).pathname;
const apiBaseUrl = 'http://127.0.0.1:4000/api/v1';
const runId = requireRunId();
const processPassword = `${randomBytes(24).toString('base64url')}A1!`;
const authMutationPattern = /\/api\/v1\/auth\/(login|refresh|logout)$/;
const authRequestPattern = /\/api\/v1\/auth\/(login|refresh|logout|me)$/;

export interface LiveAuthUser {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

interface DatabaseCleanup {
  deletedSessions: number;
  deletedUsers: number;
  remainingSessions: number;
  remainingUsers: number;
}

export interface LatestFamilyState {
  activeSessions: number;
  familyRows: number;
  unlinkedRevocations: number;
  users: number;
}

interface LiveAuthUsers {
  create(label: 'a' | 'b'): Promise<LiveAuthUser>;
}

interface AuthFixtures {
  authUsers: LiveAuthUsers;
  safeAuthDiagnostics: undefined;
}

export const test = base.extend<AuthFixtures>({
  authUsers: async ({ context: _context }, use, testInfo) => {
    const createdEmails = new Set<string>();
    const preparedEmails = new Set<string>();

    const users: LiveAuthUsers = {
      async create(label) {
        const user = deterministicUser(testInfo, label);
        if (!preparedEmails.has(user.email)) {
          const initialCleanup = await cleanupExactUsers([user.email]);
          assertCleanupComplete(initialCleanup);
          preparedEmails.add(user.email);
        }

        createdEmails.add(user.email);
        const response = await fetch(`${apiBaseUrl}/auth/register`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(user),
        });
        if (response.status !== 201) {
          throw new Error(`Temporary authentication user registration returned ${response.status}`);
        }

        return user;
      },
    };

    await use(users);

    if (createdEmails.size > 0) {
      const cleanup = await cleanupExactUsers([...createdEmails]);
      assertCleanupComplete(cleanup);
      expect(cleanup.deletedUsers).toBe(createdEmails.size);
    }
  },
  safeAuthDiagnostics: [
    async ({ context }, use, testInfo) => {
      const entries: { method: string; path: string; status: number | 'failed' }[] = [];
      const onResponse = (response: Response) => {
        const request = response.request();
        const path = safeAuthPath(request.url());
        if (path) {
          entries.push({ method: request.method(), path, status: response.status() });
        }
      };
      const onRequestFailed = (request: Request) => {
        const path = safeAuthPath(request.url());
        if (path) {
          entries.push({ method: request.method(), path, status: 'failed' });
        }
      };
      context.on('response', onResponse);
      context.on('requestfailed', onRequestFailed);

      await use(undefined);

      context.off('response', onResponse);
      context.off('requestfailed', onRequestFailed);
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('sanitized-auth-network.json', {
          body: Buffer.from(JSON.stringify(entries, null, 2)),
          contentType: 'application/json',
        });
      }
    },
    { auto: true },
  ],
});

export { expect };

export async function cleanupRunNamespace(): Promise<DatabaseCleanup> {
  return runDatabaseCommand('cleanup-prefix', []);
}

export async function inspectLatestFamily(email: string): Promise<LatestFamilyState> {
  return runDatabaseCommand('inspect-latest-family', [email]);
}

export async function login(page: Page, user: LiveAuthUser) {
  await page.getByLabel('Email').fill(user.email);
  await page.locator('#login-password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function expectUser(page: Page, user: LiveAuthUser) {
  await expect(page.getByRole('heading', { name: 'You are signed in' })).toBeVisible();
  await expect(page.getByText(`${user.firstName} ${user.lastName}`)).toBeVisible();
  await expect(page.getByText(user.email)).toBeVisible();
}

export async function expectUnauthenticated(page: Page) {
  await expect(page.getByLabel('Email')).toBeVisible();
}

export async function instrumentLifecycleEvents(context: BrowserContext) {
  await context.addInitScript(() => {
    const authWindow = window as Window & { __washqueueAuthEvents?: unknown[] };
    authWindow.__washqueueAuthEvents = [];
    const NativeBroadcastChannel = window.BroadcastChannel;
    const authChannels = new WeakSet<BroadcastChannel>();

    class InstrumentedBroadcastChannel extends NativeBroadcastChannel {
      constructor(name: string) {
        super(name);
        if (name === 'washqueue-auth-events-v1') {
          authChannels.add(this);
        }
      }

      override postMessage(message: unknown) {
        if (authChannels.has(this)) {
          authWindow.__washqueueAuthEvents?.push(message);
        }
        super.postMessage(message);
      }
    }

    Object.defineProperty(window, 'BroadcastChannel', {
      configurable: true,
      value: InstrumentedBroadcastChannel,
    });
  });
}

export async function lifecycleEvents(pages: readonly Page[]) {
  const pageEvents = await Promise.all(
    pages
      .filter((page) => !page.isClosed())
      .map((page) =>
        page.evaluate(() => {
          const authWindow = window as Window & { __washqueueAuthEvents?: unknown[] };
          return authWindow.__washqueueAuthEvents ?? [];
        }),
      ),
  );
  return pageEvents.flat();
}

export function expectSafeLifecycleEvents(events: readonly unknown[]) {
  for (const event of events) {
    expect(event).toEqual({
      sourceId: expect.any(String),
      type: expect.stringMatching(/^(session-changed|logout)$/),
    });
    expect(Object.keys(event as Record<string, unknown>).sort()).toEqual(['sourceId', 'type']);
    expect(JSON.stringify(event)).not.toMatch(
      /access.?token|refresh.?token|cookie|email|password|user.?id|session.?id|family.?id|first.?name|last.?name/i,
    );
  }
}

export function trackCookieMutations(context: BrowserContext) {
  let active = 0;
  let maximum = 0;
  const activeRequests = new Set<Request>();
  const statuses: number[] = [];
  const order: string[] = [];

  const onRequest = (request: Request) => {
    if (!authMutationPattern.test(new URL(request.url()).pathname)) {
      return;
    }
    activeRequests.add(request);
    active += 1;
    maximum = Math.max(maximum, active);
    order.push(`${new URL(request.url()).pathname.split('/').at(-1)}-start`);
  };
  const onResponse = (response: Response) => {
    const request = response.request();
    if (!activeRequests.delete(request)) {
      return;
    }
    active -= 1;
    statuses.push(response.status());
    order.push(`${new URL(request.url()).pathname.split('/').at(-1)}-${response.status()}`);
  };
  const onRequestFailed = (request: Request) => {
    if (!activeRequests.delete(request)) {
      return;
    }
    active -= 1;
    order.push(`${new URL(request.url()).pathname.split('/').at(-1)}-failed`);
  };

  context.on('request', onRequest);
  context.on('response', onResponse);
  context.on('requestfailed', onRequestFailed);

  return {
    dispose() {
      context.off('request', onRequest);
      context.off('response', onResponse);
      context.off('requestfailed', onRequestFailed);
    },
    get active() {
      return active;
    },
    get maximum() {
      return maximum;
    },
    order,
    statuses,
  };
}

export async function acquireAuthLock(page: Page) {
  await page.evaluate(() => {
    const lockWindow = window as Window & {
      __washqueueReleaseAuthLock?: () => void;
      __washqueueAuthLockHeld?: boolean;
    };
    void navigator.locks.request('washqueue-auth-cookie-mutation-v1', { mode: 'exclusive' }, () => {
      lockWindow.__washqueueAuthLockHeld = true;
      return new Promise<void>((resolve) => {
        lockWindow.__washqueueReleaseAuthLock = resolve;
      });
    });
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const lockWindow = window as Window & { __washqueueAuthLockHeld?: boolean };
        return lockWindow.__washqueueAuthLockHeld === true;
      }),
    )
    .toBe(true);
}

export async function releaseAuthLock(page: Page) {
  await page.evaluate(() => {
    const lockWindow = window as Window & { __washqueueReleaseAuthLock?: () => void };
    lockWindow.__washqueueReleaseAuthLock?.();
  });
}

export async function pendingAuthLockRequests(page: Page) {
  return page.evaluate(async () => {
    const snapshot = await navigator.locks.query();
    return snapshot.pending?.filter(
      (request) => request.name === 'washqueue-auth-cookie-mutation-v1',
    ).length;
  });
}

export async function expectNoCredentialPersistence(
  pages: readonly Page[],
  users: readonly LiveAuthUser[],
) {
  for (const page of pages) {
    if (page.isClosed()) {
      continue;
    }
    const state = await page.evaluate(async () => ({
      cookie: document.cookie,
      html: document.documentElement.innerHTML,
      indexedDb: indexedDB.databases ? await indexedDB.databases() : [],
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
    }));
    const serialized = JSON.stringify(state);
    for (const user of users) {
      expect(serialized).not.toContain(user.password);
    }
    expect(state.cookie).not.toContain('washqueue_refresh');
  }
}

function deterministicUser(testInfo: TestInfo, label: 'a' | 'b'): LiveAuthUser {
  const digest = createHash('sha256')
    .update(`${runId}:${testInfo.project.name}:${testInfo.titlePath.join(':')}:${label}`)
    .digest('hex')
    .slice(0, 16);
  return {
    email: `wq-auth-${runId}-${digest}-${label}@auth-e2e.invalid`,
    firstName: label === 'a' ? 'Lifecycle' : 'Account',
    lastName: label === 'a' ? 'Alpha' : 'Beta',
    password: processPassword,
  };
}

function requireRunId() {
  const value = process.env.AUTH_E2E_RUN_ID ?? 'local';
  if (!/^[a-z0-9-]{1,32}$/.test(value)) {
    throw new Error('AUTH_E2E_RUN_ID must contain only lowercase letters, digits, and hyphens');
  }
  return value;
}

async function cleanupExactUsers(emails: readonly string[]): Promise<DatabaseCleanup> {
  return runDatabaseCommand('cleanup-exact', [...emails]);
}

async function runDatabaseCommand<Result>(action: string, argumentsAfterAction: string[]) {
  try {
    const { stdout } = await execFileAsync(
      'pnpm',
      [
        '--filter',
        '@washqueue/api',
        'exec',
        'node',
        'test-support/auth-e2e-database.mjs',
        action,
        ...argumentsAfterAction,
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          AUTH_E2E_RUN_ID: runId,
          NODE_ENV: 'test',
        },
      },
    );
    return JSON.parse(stdout.trim()) as Result;
  } catch (error) {
    const stdout =
      typeof error === 'object' && error !== null && 'stdout' in error
        ? String(error.stdout).trim()
        : '';
    if (stdout) {
      return JSON.parse(stdout) as Result;
    }
    throw new Error('Authentication E2E database assertion failed', { cause: error });
  }
}

function assertCleanupComplete(cleanup: DatabaseCleanup) {
  expect(cleanup.remainingUsers).toBe(0);
  expect(cleanup.remainingSessions).toBe(0);
}

function safeAuthPath(url: string) {
  const path = new URL(url).pathname;
  return authRequestPattern.test(path) ? path : null;
}
