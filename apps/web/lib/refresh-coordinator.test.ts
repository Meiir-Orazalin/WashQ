import type { RefreshResponse } from '@washqueue/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createRefreshCoordinator } from './refresh-coordinator';

const response: RefreshResponse = {
  accessToken: 'transient-access-token',
  accessTokenExpiresAt: '2026-07-28T12:15:00.000Z',
};

describe('refresh coordinator', () => {
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
});
