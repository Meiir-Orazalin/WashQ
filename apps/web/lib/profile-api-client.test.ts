import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, updateCurrentUserProfile } from './api-client';

const user = {
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Updated',
  lastName: null,
  email: 'profile@example.invalid',
};
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('profile client', () => {
  it('sends only normalized names with explicit Bearer, PATCH, no credentials/cache and abort support', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ user }));
    vi.stubGlobal('fetch', fetcher);
    const abort = new AbortController();
    expect(
      await updateCurrentUserProfile(
        'test-only-token',
        { firstName: ' Updated ', lastName: ' ' },
        abort.signal,
      ),
    ).toEqual({ user });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\/users\/me$/),
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'omit',
        cache: 'no-store',
        signal: abort.signal,
        body: JSON.stringify({ firstName: 'Updated', lastName: null }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-only-token',
        },
      }),
    );
  });
  it('rejects invalid and spoofed input before transport', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(updateCurrentUserProfile('test-only-token', {})).rejects.toBeInstanceOf(
      ApiClientError,
    );
    const input = { firstName: 'Updated', userId: 'untrusted' };
    await expect(updateCurrentUserProfile('test-only-token', input)).rejects.toBeInstanceOf(
      ApiClientError,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([400, 401, 500])('sanitizes %s without retry', async (status) => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: status === 401 ? 'AUTHENTICATION_REQUIRED' : 'INTERNAL_SERVER_ERROR',
            message: 'private-database-details',
          },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/me',
          requestId: 'request-id',
        },
        { status },
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(
      updateCurrentUserProfile('test-only-token', { firstName: 'Updated' }),
    ).rejects.toMatchObject({ message: 'The profile update failed', status });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    { user: { ...user, passwordHash: 'internal' } },
    { user, sessions: [] },
    { user: { ...user, id: 'invalid' } },
  ])('rejects non-public success %#', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(
      updateCurrentUserProfile('test-only-token', { firstName: 'Updated' }),
    ).rejects.toThrow('The API returned an invalid current-user response');
  });
  it('sanitizes network and invalid JSON failures', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('private transport details'))
      .mockResolvedValueOnce(new Response('not json'));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      updateCurrentUserProfile('test-only-token', { firstName: 'Updated' }),
    ).rejects.toThrow('The profile request could not be completed');
    await expect(
      updateCurrentUserProfile('test-only-token', { firstName: 'Updated' }),
    ).rejects.toThrow('The API returned an invalid current-user response');
  });
});
