import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LoginUser, RefreshResponse } from '@washqueue/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from '@/components/login-form';
import { ApiClientError } from '@/lib/api-client';
import { createRefreshCoordinator, type RefreshCoordinator } from '@/lib/refresh-coordinator';
import { AuthenticationProvider, useAuthentication } from './authentication-provider';

const user: LoginUser = {
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Current',
  lastName: 'Customer',
  email: 'meiir@example.com',
};

function futureTimestamp(milliseconds = 15 * 60_000) {
  return new Date(Date.now() + milliseconds).toISOString();
}

function refreshResponse(accessToken: string, milliseconds = 15 * 60_000): RefreshResponse {
  return {
    accessToken,
    accessTokenExpiresAt: futureTimestamp(milliseconds),
  };
}

function invalidRefreshSession() {
  return new ApiClientError('Session refresh failed', 401, 'INVALID_REFRESH_SESSION');
}

function apiError(status: number, code: string) {
  return new ApiClientError('Sanitized API failure', status, code);
}

function currentUserResponse(status = 200) {
  const payload =
    status === 200
      ? { user }
      : {
          error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required' },
          timestamp: new Date().toISOString(),
          path: '/api/v1/auth/me',
          requestId: 'request-id',
        };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderProvider(
  refreshCoordinator: RefreshCoordinator,
  { strict = false, withLoginForm = false }: { strict?: boolean; withLoginForm?: boolean } = {},
) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const content = (
    <QueryClientProvider client={client}>
      <AuthenticationProvider refreshCoordinator={refreshCoordinator}>
        {withLoginForm ? <LoginForm /> : null}
        <AuthenticationProbe />
      </AuthenticationProvider>
    </QueryClientProvider>
  );
  const rendered = render(strict ? <StrictMode>{content}</StrictMode> : content);
  return { ...rendered, client };
}

function AuthenticationProbe() {
  const authentication = useAuthentication();

  return (
    <>
      <output
        data-testid="authentication-state"
        data-status={authentication.status}
        data-access-token={authentication.accessToken ? 'present' : 'absent'}
        data-expiration={authentication.accessTokenExpiresAt ?? 'absent'}
        data-user={authentication.currentUser?.email ?? 'absent'}
      />
      <button
        type="button"
        onClick={() => {
          authentication.beginAuthentication();
          authentication.stageAccessToken('explicit-login-token', futureTimestamp(120_000));
          authentication.completeAuthentication({
            ...user,
            firstName: 'Explicit',
          });
        }}
      >
        Complete explicit login
      </button>
    </>
  );
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AuthenticationProvider restoration', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'cookie');
  });

  it('starts with an accessible initializing state and does not flash the login form', () => {
    const coordinator = createRefreshCoordinator(
      () => new Promise<RefreshResponse>(() => undefined),
    );

    renderProvider(coordinator, { withLoginForm: true });

    expect(screen.getByText('Restoring your session…').closest('[role="status"]')).toBeVisible();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'initializing',
    );
  });

  it('restores through refresh and exactly one credential-omitting /me request', async () => {
    const restoredToken = 'restored-memory-token';
    const coordinator = {
      refresh: vi.fn().mockResolvedValue(refreshResponse(restoredToken)),
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(currentUserResponse());
    vi.stubGlobal('fetch', fetchMock);

    renderProvider(coordinator);

    await waitFor(() =>
      expect(screen.getByTestId('authentication-state')).toHaveAttribute(
        'data-status',
        'authenticated',
      ),
    );
    expect(coordinator.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${restoredToken}`,
      },
    });
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-user', user.email);
  });

  it('treats invalid refresh as unauthenticated and never calls /me', async () => {
    const coordinator = { refresh: vi.fn().mockRejectedValue(invalidRefreshSession()) };
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    renderProvider(coordinator, { withLoginForm: true });

    expect(await screen.findByLabelText('Email')).toBeVisible();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'unauthenticated',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(coordinator.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an origin rejection', apiError(403, 'ORIGIN_NOT_ALLOWED')],
    ['a network failure', new ApiClientError('The refresh request could not be completed')],
    ['a server failure', apiError(500, 'INTERNAL_SERVER_ERROR')],
    ['an invalid response', new ApiClientError('The API returned an invalid refresh response')],
  ])('shows a recoverable restoration error for %s without retrying', async (_name, failure) => {
    const coordinator = { refresh: vi.fn().mockRejectedValue(failure) };
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    renderProvider(coordinator, { withLoginForm: true });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not restore your session. You can continue by signing in again.',
    );
    expect(coordinator.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to sign in' }));
    expect(await screen.findByLabelText('Email')).toBeVisible();
    expect(coordinator.refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['authentication-required', () => Promise.resolve(currentUserResponse(401)), 'unauthenticated'],
    ['network failure', () => Promise.reject(new TypeError('offline')), 'error'],
    [
      'server failure',
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'An unexpected error occurred',
              },
              timestamp: new Date().toISOString(),
              path: '/api/v1/auth/me',
              requestId: 'request-id',
            }),
            { status: 500 },
          ),
        ),
      'error',
    ],
    [
      'invalid response',
      () =>
        Promise.resolve(new Response(JSON.stringify({ user: { id: 'invalid' } }), { status: 200 })),
      'error',
    ],
  ])('clears the staged token when /me has a %s', async (_name, response, expectedStatus) => {
    const coordinator = {
      refresh: vi.fn().mockResolvedValue(refreshResponse('staged-restoration-token')),
    };
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(response));

    renderProvider(coordinator);

    await waitFor(() =>
      expect(screen.getByTestId('authentication-state')).toHaveAttribute(
        'data-status',
        expectedStatus,
      ),
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
    expect(coordinator.refresh).toHaveBeenCalledTimes(1);
  });

  it('allows one startup rotation under React Strict Mode', async () => {
    let resolveRefresh: ((response: RefreshResponse) => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<RefreshResponse>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const coordinator = createRefreshCoordinator(request);
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(currentUserResponse()));

    renderProvider(coordinator, { strict: true });
    expect(request).toHaveBeenCalledTimes(1);

    resolveRefresh?.(refreshResponse('strict-mode-token'));
    await waitFor(() =>
      expect(screen.getByTestId('authentication-state')).toHaveAttribute(
        'data-status',
        'authenticated',
      ),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not let stale restoration overwrite a newer explicit login', async () => {
    let resolveRefresh: ((response: RefreshResponse) => void) | undefined;
    const coordinator = {
      refresh: vi.fn(
        () =>
          new Promise<RefreshResponse>((resolve) => {
            resolveRefresh = resolve;
          }),
      ),
    };
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    renderProvider(coordinator);

    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'authenticated',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-user', user.email);

    resolveRefresh?.(refreshResponse('stale-restoration-token'));
    await flushMicrotasks();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'authenticated',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-expiration',
      expect.stringContaining('T'),
    );
  });

  it('does not persist or render credentials during restoration', async () => {
    const accessToken = 'storage-security-access-token';
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const indexedDatabaseOpen = vi.fn();
    const cookieRead = vi.fn(() => '');
    const cookieWrite = vi.fn();
    vi.stubGlobal('indexedDB', { open: indexedDatabaseOpen });
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: cookieRead,
      set: cookieWrite,
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(currentUserResponse()));
    const coordinator = {
      refresh: vi.fn().mockResolvedValue(refreshResponse(accessToken)),
    };

    const { client } = renderProvider(coordinator);
    await waitFor(() =>
      expect(screen.getByTestId('authentication-state')).toHaveAttribute(
        'data-status',
        'authenticated',
      ),
    );

    expect(storageWrite).not.toHaveBeenCalled();
    expect(indexedDatabaseOpen).not.toHaveBeenCalled();
    expect(cookieRead).not.toHaveBeenCalled();
    expect(cookieWrite).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain(accessToken);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain(accessToken);
  });
});

describe('AuthenticationProvider refresh scheduling and visibility', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderAuthenticatedWithTimer(
    proactiveResult: RefreshResponse | Error,
    expiresInMilliseconds = 120_000,
  ) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
    const refresh = vi
      .fn<() => Promise<RefreshResponse>>()
      .mockRejectedValueOnce(invalidRefreshSession());
    if (proactiveResult instanceof Error) {
      refresh.mockRejectedValueOnce(proactiveResult);
    } else {
      refresh.mockResolvedValueOnce(proactiveResult);
    }
    renderProvider({ refresh });
    await flushMicrotasks();

    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));
    if (expiresInMilliseconds !== 120_000) {
      throw new Error('Use the expiration-specific visibility harness for custom lifetimes');
    }
    await flushMicrotasks();
    return refresh;
  }

  it('schedules one refresh at the safety window and replaces the timer on success', async () => {
    const refresh = await renderAuthenticatedWithTimer(refreshResponse('rotated-token', 180_000));

    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'authenticated',
    );
    expect(vi.getTimerCount()).toBe(1);
  });

  it('clears authentication and scheduling after an invalid proactive session', async () => {
    const refresh = await renderAuthenticatedWithTimer(invalidRefreshSession());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'unauthenticated',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a still-valid token after an indeterminate failure, does not retry, then errors at expiry', async () => {
    const refresh = await renderAuthenticatedWithTimer(
      new ApiClientError('The refresh request could not be completed'),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'authenticated',
    );
    expect(vi.getTimerCount()).toBe(1);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(document, new Event('visibilitychange'));
    await flushMicrotasks();
    expect(refresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-status', 'error');
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes once when visibility returns near expiration and ignores far-away visibility', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
    let resolveProactive: ((response: RefreshResponse) => void) | undefined;
    const refresh = vi
      .fn<() => Promise<RefreshResponse>>()
      .mockRejectedValueOnce(invalidRefreshSession())
      .mockImplementationOnce(
        () =>
          new Promise<RefreshResponse>((resolve) => {
            resolveProactive = resolve;
          }),
      );
    renderProvider({ refresh });
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));
    await flushMicrotasks();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    fireEvent(document, new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-07-28T12:01:10.000Z'));
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(document, new Event('visibilitychange'));
    expect(refresh).toHaveBeenCalledTimes(2);

    resolveProactive?.(refreshResponse('visibility-rotated-token', 180_000));
    await flushMicrotasks();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('clears its timer and visibility listener on unmount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const coordinator = { refresh: vi.fn().mockRejectedValue(invalidRefreshSession()) };
    const rendered = renderProvider(coordinator);
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));
    await flushMicrotasks();
    expect(vi.getTimerCount()).toBe(1);

    rendered.unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
