import type { RefreshResponse } from '@washqueue/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRefreshCoordinator } from './refresh-coordinator';

const response: RefreshResponse = {
  accessToken: 'transient-access-token',
  accessTokenExpiresAt: '2026-07-28T12:15:00.000Z',
};
const defaultLockManager = navigator.locks;

describe('refresh coordinator', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: defaultLockManager,
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('wraps the complete default refresh request in the cross-tab lock', async () => {
    const order: string[] = [];
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        async request<T>(
          _name: string,
          _options: { mode: 'exclusive' },
          callback: () => Promise<T>,
        ): Promise<T> {
          order.push('lock-acquired');
          const result = await callback();
          order.push('lock-released');
          return result;
        },
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async () => {
        order.push('refresh-request');
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    await expect(createRefreshCoordinator().refresh()).resolves.toEqual(response);

    expect(order).toEqual(['lock-acquired', 'refresh-request', 'lock-released']);
  });

  it('returns one shared in-flight Promise to concurrent callers', async () => {
    let resolveRequest: ((value: RefreshResponse) => void) | undefined;
    const pending = new Promise<RefreshResponse>((resolve) => {
      resolveRequest = resolve;
    });
    const request = vi.fn().mockReturnValue(pending);
    const coordinator = createRefreshCoordinator(request);

    const first = coordinator.refresh();
    const second = coordinator.refresh();
    const third = coordinator.refresh();

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(request).toHaveBeenCalledTimes(1);

    resolveRequest?.(response);
    await expect(first).resolves.toEqual(response);
  });

  it('drops the settled result and starts a new request after success', async () => {
    const request = vi.fn().mockResolvedValue(response);
    const coordinator = createRefreshCoordinator(request);

    await coordinator.refresh();
    await coordinator.refresh();

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('resets after failure and does not expose token values through errors', async () => {
    const request = vi
      .fn<() => Promise<RefreshResponse>>()
      .mockRejectedValueOnce(new Error('sanitized refresh failure'))
      .mockResolvedValueOnce(response);
    const coordinator = createRefreshCoordinator(request);

    const firstError = await coordinator.refresh().catch((error: unknown) => error);
    await expect(coordinator.refresh()).resolves.toEqual(response);

    expect(request).toHaveBeenCalledTimes(2);
    expect(String(firstError)).not.toContain(response.accessToken);
  });

  it('waits for the current refresh to settle without starting or exposing another request', async () => {
    let resolveRequest: ((value: RefreshResponse) => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<RefreshResponse>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const coordinator = createRefreshCoordinator(request);
    const refresh = coordinator.refresh();
    let idle = false;
    const waiting = coordinator.waitForIdle().then(() => {
      idle = true;
    });

    await Promise.resolve();
    expect(idle).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);

    resolveRequest?.(response);
    await refresh;
    await waiting;

    expect(idle).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('resolves the idle barrier after a refresh failure', async () => {
    let rejectRequest: ((reason: Error) => void) | undefined;
    const coordinator = createRefreshCoordinator(
      () =>
        new Promise<RefreshResponse>((_resolve, reject) => {
          rejectRequest = reject;
        }),
    );
    const refresh = coordinator.refresh();
    const waiting = coordinator.waitForIdle();

    rejectRequest?.(new Error('sanitized refresh failure'));

    await expect(refresh).rejects.toThrow('sanitized refresh failure');
    await expect(waiting).resolves.toBeUndefined();
  });
});
