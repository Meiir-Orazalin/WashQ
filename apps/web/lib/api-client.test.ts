import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, logoutCurrentSession, refreshSession } from './api-client';

const refreshToken = 'validated-memory-access-token';

function futureTimestamp() {
  return new Date(Date.now() + 15 * 60_000).toISOString();
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function apiError(status: number, code: string) {
  return jsonResponse(
    {
      error: { code, message: 'Sanitized API error' },
      timestamp: new Date().toISOString(),
      path: '/api/v1/auth/refresh',
      requestId: 'request-id',
    },
    status,
  );
}

describe('refreshSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('posts without a body or Authorization header and parses the shared response', async () => {
    const response = {
      accessToken: refreshToken,
      accessTokenExpiresAt: futureTimestamp(),
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshSession()).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/api\/v1\/auth\/refresh$/);
    expect(request).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    expect(request?.body).toBeUndefined();
    expect(new Headers(request?.headers).has('Authorization')).toBe(false);
  });

  it('rejects an invalid successful response without exposing its token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          accessToken: refreshToken,
          accessTokenExpiresAt: 'not-a-timestamp',
        }),
      ),
    );

    const error = await refreshSession().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(String(error)).not.toContain(refreshToken);
  });

  it('rejects invalid JSON safely without retrying', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshSession()).rejects.toMatchObject({
      name: 'ApiClientError',
      message: 'The API returned an invalid refresh response',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'INVALID_REFRESH_SESSION'],
    [403, 'ORIGIN_NOT_ALLOWED'],
    [500, 'INTERNAL_SERVER_ERROR'],
  ])('classifies HTTP %i safely without retrying', async (status, code) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(apiError(status, code));
    vi.stubGlobal('fetch', fetchMock);

    const error = await refreshSession().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status, code });
    expect(String(error)).not.toContain(code);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies a network failure safely without retrying', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(refreshSession()).rejects.toMatchObject({
      name: 'ApiClientError',
      message: 'The refresh request could not be completed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('logoutCurrentSession', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('posts credentials without a body or Authorization header and accepts an empty 204', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(logoutCurrentSession()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/\/api\/v1\/auth\/logout$/);
    expect(request).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    expect(request?.body).toBeUndefined();
    expect(new Headers(request?.headers).has('Authorization')).toBe(false);
  });

  it.each([
    [403, 'ORIGIN_NOT_ALLOWED'],
    [500, 'INTERNAL_SERVER_ERROR'],
  ])('classifies HTTP %i safely without retrying', async (status, code) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(apiError(status, code));
    vi.stubGlobal('fetch', fetchMock);

    const error = await logoutCurrentSession().catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status, code });
    expect(String(error)).not.toContain(code);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('classifies a network failure safely without retrying or leaking request data', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(logoutCurrentSession()).rejects.toMatchObject({
      name: 'ApiClientError',
      message: 'The logout request could not be completed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-204 success without attempting a second request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 200));
    vi.stubGlobal('fetch', fetchMock);

    await expect(logoutCurrentSession()).rejects.toMatchObject({
      name: 'ApiClientError',
      message: 'Logout failed',
      status: 200,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
