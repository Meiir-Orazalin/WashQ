import { describe, expect, it, vi } from 'vitest';
import {
  AuthCoordinationUnavailableError,
  authCookieMutationLockName,
  authCoordinationUnavailableCode,
  createAuthCookieMutationLock,
} from './auth-cookie-mutation-lock';

describe('auth cookie mutation lock', () => {
  it('runs the operation inside the stable exclusive Web Lock and returns its result', async () => {
    const order: string[] = [];
    let requestCount = 0;
    const manager = {
      async request<T>(
        name: string,
        options: { mode: 'exclusive' },
        callback: () => Promise<T>,
      ): Promise<T> {
        requestCount += 1;
        order.push('lock-acquired');
        expect(name).toBe(authCookieMutationLockName);
        expect(options).toEqual({ mode: 'exclusive' });
        const result = await callback();
        order.push('lock-released');
        return result;
      },
    };
    const lock = createAuthCookieMutationLock(() => manager);

    const result = await lock.runExclusive(async () => {
      order.push('operation');
      return 'completed';
    });

    expect(result).toBe('completed');
    expect(order).toEqual(['lock-acquired', 'operation', 'lock-released']);
    expect(requestCount).toBe(1);
  });

  it('propagates a sanitized operation exception and releases the lock', async () => {
    const order: string[] = [];
    const operationError = new Error('sanitized operation failure');
    const manager = {
      async request<T>(
        _name: string,
        _options: { mode: 'exclusive' },
        callback: () => Promise<T>,
      ): Promise<T> {
        order.push('lock-acquired');
        try {
          return await callback();
        } finally {
          order.push('lock-released');
        }
      },
    };
    const lock = createAuthCookieMutationLock(() => manager);

    await expect(
      lock.runExclusive(async () => {
        order.push('operation');
        throw operationError;
      }),
    ).rejects.toBe(operationError);

    expect(order).toEqual(['lock-acquired', 'operation', 'lock-released']);
  });

  it.each([
    ['refresh', 'logout'],
    ['refresh', 'login'],
    ['login', 'logout'],
  ])('orders %s before %s without overlapping cookie mutations', async (firstName, secondName) => {
    let tail: Promise<void> = Promise.resolve();
    const order: string[] = [];
    const manager = {
      request<T>(
        _name: string,
        _options: { mode: 'exclusive' },
        callback: () => Promise<T>,
      ): Promise<T> {
        const result = tail.then(callback);
        tail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    };
    const lock = createAuthCookieMutationLock(() => manager);
    let releaseFirst: (() => void) | undefined;
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = lock.runExclusive(async () => {
      order.push(`${firstName}-start`);
      await firstBarrier;
      order.push(`${firstName}-end`);
    });
    const second = lock.runExclusive(async () => {
      order.push(`${secondName}-start`);
      order.push(`${secondName}-end`);
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([`${firstName}-start`]);

    releaseFirst?.();
    await Promise.all([first, second]);

    expect(order).toEqual([
      `${firstName}-start`,
      `${firstName}-end`,
      `${secondName}-start`,
      `${secondName}-end`,
    ]);
  });

  it('fails closed when Web Locks are unavailable and never calls the operation', async () => {
    const operation = vi.fn<() => Promise<void>>();
    const lock = createAuthCookieMutationLock(() => undefined);

    const error = await lock.runExclusive(operation).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthCoordinationUnavailableError);
    expect(error).toMatchObject({ code: authCoordinationUnavailableCode });
    expect(operation).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'capability lookup',
      createLock: () =>
        createAuthCookieMutationLock(() => {
          throw new Error('secret-token-from-capability');
        }),
    },
    {
      name: 'lock acquisition',
      createLock: () =>
        createAuthCookieMutationLock(() => ({
          request: async () => {
            throw new Error('secret-token-from-lock-manager');
          },
        })),
    },
  ])('sanitizes a failed $name without starting the operation', async ({ createLock }) => {
    const operation = vi.fn<() => Promise<void>>();

    const error = await createLock()
      .runExclusive(operation)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthCoordinationUnavailableError);
    expect(String(error)).not.toContain('secret-token');
    expect(String(error)).not.toContain(authCookieMutationLockName);
    expect(operation).not.toHaveBeenCalled();
  });

  it('retains no settled authentication result or user data', async () => {
    const manager = {
      async request<T>(
        _name: string,
        _options: { mode: 'exclusive' },
        callback: () => Promise<T>,
      ): Promise<T> {
        return callback();
      },
    };
    const lock = createAuthCookieMutationLock(() => manager);

    await lock.runExclusive(async () => ({
      accessToken: 'transient-test-token',
      email: 'customer@example.com',
    }));

    expect(Object.keys(lock)).toEqual(['runExclusive']);
    expect(JSON.stringify(lock)).not.toContain('transient-test-token');
    expect(JSON.stringify(lock)).not.toContain('customer@example.com');
  });
});
