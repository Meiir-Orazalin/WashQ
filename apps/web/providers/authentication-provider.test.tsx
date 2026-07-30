import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LoginUser, RefreshResponse } from '@washqueue/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from '@/components/login-form';
import { AuthCoordinationUnavailableError } from '@/lib/auth-cookie-mutation-lock';
import type { AuthLifecycleChannel, AuthLifecycleEvent } from '@/lib/auth-lifecycle-channel';
import { ApiClientError } from '@/lib/api-client';
import { createRefreshCoordinator, type RefreshCoordinator } from '@/lib/refresh-coordinator';
import { AuthenticationProvider, useAuthentication } from './authentication-provider';

const user: LoginUser = {
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Current',
  lastName: 'Customer',
  email: 'meiir@example.com',
};
const defaultLockManager = navigator.locks;

class TestAuthLifecycleChannel implements AuthLifecycleChannel {
  readonly publishSessionChanged = vi.fn();
  readonly publishLogout = vi.fn();
  readonly close = vi.fn();
  private readonly subscribers = new Set<(event: AuthLifecycleEvent) => void>();

  subscribe(listener: (event: AuthLifecycleEvent) => void) {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  emit(type: AuthLifecycleEvent['type']) {
    const event = { type, sourceId: 'remote-document' } satisfies AuthLifecycleEvent;
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }
}

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

function currentUserResponse(status = 200, responseUser: LoginUser = user) {
  const payload =
    status === 200
      ? { user: responseUser }
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

const otherUser: LoginUser = {
  id: '00e6bf3c-e971-43f8-ac67-90776016f24d',
  firstName: 'Other',
  lastName: 'Customer',
  email: 'other@example.com',
};

function renderProvider(
  refreshCoordinator: Pick<RefreshCoordinator, 'refresh'> &
    Partial<Pick<RefreshCoordinator, 'waitForIdle'>>,
  {
    strict = false,
    withLoginForm = false,
    lifecycleChannel,
  }: {
    strict?: boolean;
    withLoginForm?: boolean;
    lifecycleChannel?: AuthLifecycleChannel;
  } = {},
) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const coordinator: RefreshCoordinator = {
    refresh: refreshCoordinator.refresh,
    waitForIdle: refreshCoordinator.waitForIdle ?? vi.fn().mockResolvedValue(undefined),
  };
  const content = (
    <QueryClientProvider client={client}>
      <AuthenticationProvider
        refreshCoordinator={coordinator}
        {...(lifecycleChannel ? { lifecycleChannelFactory: () => lifecycleChannel } : {})}
      >
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
        data-token-kind={
          authentication.accessToken === 'explicit-login-token'
            ? 'explicit'
            : authentication.accessToken
              ? 'refreshed'
              : 'absent'
        }
        data-expiration={authentication.accessTokenExpiresAt ?? 'absent'}
        data-user={authentication.currentUser?.email ?? 'absent'}
      />
      <button
        type="button"
        onClick={() => {
          const generation = authentication.beginAuthentication();
          if (generation === null) {
            return;
          }
          authentication.completeAuthentication(
            'explicit-login-token',
            futureTimestamp(120_000),
            {
              ...user,
              firstName: 'Explicit',
            },
            generation,
          );
        }}
      >
        Complete explicit login
      </button>
      <button type="button" onClick={() => void authentication.logout()}>
        Trigger logout
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
    const lifecycleChannel = new TestAuthLifecycleChannel();

    renderProvider(coordinator, { lifecycleChannel });

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
    expect(lifecycleChannel.publishSessionChanged).not.toHaveBeenCalled();
    expect(lifecycleChannel.publishLogout).not.toHaveBeenCalled();
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

  it('surfaces a safe coordination error without calling /me or retrying', async () => {
    const coordinator = {
      refresh: vi.fn().mockRejectedValue(new AuthCoordinationUnavailableError()),
    };
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    renderProvider(coordinator, { withLoginForm: true });

    expect(
      await screen.findByRole('heading', {
        name: 'We could not safely coordinate your session',
      }),
    ).toBeVisible();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'coordination-error',
    );
    expect(coordinator.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
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
      'We could not safely update your session. You can continue by signing in again.',
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

describe('AuthenticationProvider cross-tab lifecycle synchronization', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'cookie');
  });

  async function renderLocallyAuthenticated(
    refresh: RefreshCoordinator['refresh'],
    lifecycleChannel: TestAuthLifecycleChannel,
    withLoginForm = false,
  ) {
    renderProvider(
      { refresh },
      {
        lifecycleChannel,
        withLoginForm,
      },
    );
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));
    await flushMicrotasks();
    lifecycleChannel.publishSessionChanged.mockClear();
  }

  it('clears the old identity immediately, then refreshes and verifies the authoritative user', async () => {
    let resolveRefresh: ((response: RefreshResponse) => void) | undefined;
    const order: string[] = [];
    const refresh = vi
      .fn<RefreshCoordinator['refresh']>()
      .mockRejectedValueOnce(invalidRefreshSession())
      .mockImplementationOnce(
        () =>
          new Promise<RefreshResponse>((resolve) => {
            order.push('refresh');
            resolveRefresh = resolve;
          }),
      );
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      order.push('me');
      return currentUserResponse(200, otherUser);
    });
    vi.stubGlobal('fetch', fetchMock);
    const lifecycleChannel = new TestAuthLifecycleChannel();
    await renderLocallyAuthenticated(refresh, lifecycleChannel, true);
    expect(screen.getByText(user.email)).toBeVisible();

    act(() => {
      lifecycleChannel.emit('session-changed');
    });

    expect(screen.getByRole('heading', { name: 'Updating your session…' })).toBeVisible();
    expect(screen.queryByText(user.email)).not.toBeInTheDocument();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-user', 'absent');
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();

    resolveRefresh?.(refreshResponse('remote-account-token'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('authentication-state')).toHaveAttribute(
        'data-status',
        'authenticated',
      ),
    );

    expect(order).toEqual(['refresh', 'me']);
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-user',
      otherUser.email,
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-token-kind',
      'refreshed',
    );
    expect(lifecycleChannel.publishSessionChanged).not.toHaveBeenCalled();
  });

  it.each([
    [
      'refresh 401',
      () => Promise.reject(invalidRefreshSession()),
      vi.fn<typeof fetch>(),
      'unauthenticated',
    ],
    [
      '/me 401',
      () => Promise.resolve(refreshResponse('unverified-remote-token')),
      vi.fn<typeof fetch>().mockResolvedValue(currentUserResponse(401)),
      'unauthenticated',
    ],
    [
      'an indeterminate refresh failure',
      () => Promise.reject(new ApiClientError('The refresh request could not be completed')),
      vi.fn<typeof fetch>(),
      'error',
    ],
  ])(
    'fails closed for %s without retaining or rebroadcasting credentials',
    async (_name, remoteResult, fetchMock, expectedStatus) => {
      const refresh = vi
        .fn<RefreshCoordinator['refresh']>()
        .mockRejectedValueOnce(invalidRefreshSession())
        .mockImplementationOnce(remoteResult);
      vi.stubGlobal('fetch', fetchMock);
      const lifecycleChannel = new TestAuthLifecycleChannel();
      await renderLocallyAuthenticated(refresh, lifecycleChannel);

      act(() => {
        lifecycleChannel.emit('session-changed');
      });

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
      expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-user', 'absent');
      expect(lifecycleChannel.publishSessionChanged).not.toHaveBeenCalled();
      expect(refresh).toHaveBeenCalledTimes(2);
    },
  );

  it('does not let a stale remote synchronization overwrite a newer explicit login', async () => {
    let resolveRemoteRefresh: ((response: RefreshResponse) => void) | undefined;
    const refresh = vi
      .fn<RefreshCoordinator['refresh']>()
      .mockRejectedValueOnce(invalidRefreshSession())
      .mockImplementationOnce(
        () =>
          new Promise<RefreshResponse>((resolve) => {
            resolveRemoteRefresh = resolve;
          }),
      );
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const lifecycleChannel = new TestAuthLifecycleChannel();
    await renderLocallyAuthenticated(refresh, lifecycleChannel);

    act(() => {
      lifecycleChannel.emit('session-changed');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'authenticated',
    );

    resolveRemoteRefresh?.(refreshResponse('stale-remote-token'));
    await flushMicrotasks();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-token-kind',
      'explicit',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-user', user.email);
  });

  it('coalesces repeated remote events without unbounded refresh or /me work', async () => {
    let resolveRemoteRefresh: ((response: RefreshResponse) => void) | undefined;
    const requestRefresh = vi
      .fn<() => Promise<RefreshResponse>>()
      .mockRejectedValueOnce(invalidRefreshSession())
      .mockImplementationOnce(
        () =>
          new Promise<RefreshResponse>((resolve) => {
            resolveRemoteRefresh = resolve;
          }),
      );
    const coordinator = createRefreshCoordinator(requestRefresh);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(currentUserResponse(200, otherUser));
    vi.stubGlobal('fetch', fetchMock);
    const lifecycleChannel = new TestAuthLifecycleChannel();
    await renderLocallyAuthenticated(coordinator.refresh, lifecycleChannel);

    act(() => {
      for (let event = 0; event < 20; event += 1) {
        lifecycleChannel.emit('session-changed');
      }
    });

    expect(requestRefresh).toHaveBeenCalledTimes(2);
    resolveRemoteRefresh?.(refreshResponse('coalesced-remote-token'));
    await waitFor(() =>
      expect(screen.getByTestId('authentication-state')).toHaveAttribute(
        'data-status',
        'authenticated',
      ),
    );

    expect(requestRefresh).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lifecycleChannel.publishSessionChanged).not.toHaveBeenCalled();
  });

  it('fails closed before refresh when BroadcastChannel is unavailable', async () => {
    const refresh = vi.fn<RefreshCoordinator['refresh']>();
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <AuthenticationProvider
          refreshCoordinator={{
            refresh,
            waitForIdle: vi.fn().mockResolvedValue(undefined),
          }}
          lifecycleChannelFactory={() => null}
        >
          <LoginForm />
          <AuthenticationProbe />
        </AuthenticationProvider>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Your browser cannot safely update sessions across tabs',
      }),
    ).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('closes the lifecycle channel when the provider unmounts', async () => {
    const lifecycleChannel = new TestAuthLifecycleChannel();
    const rendered = renderProvider(
      { refresh: vi.fn().mockRejectedValue(invalidRefreshSession()) },
      { lifecycleChannel },
    );
    await flushMicrotasks();

    rendered.unmount();

    expect(lifecycleChannel.close).toHaveBeenCalledTimes(1);
  });
});

describe('AuthenticationProvider remote logout', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('clears memory and timers immediately without logout, refresh, /me, or rebroadcast', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
    const refresh = vi
      .fn<RefreshCoordinator['refresh']>()
      .mockRejectedValueOnce(invalidRefreshSession());
    const waitForIdle = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const lifecycleChannel = new TestAuthLifecycleChannel();
    renderProvider({ refresh, waitForIdle }, { lifecycleChannel });
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));
    await flushMicrotasks();
    lifecycleChannel.publishSessionChanged.mockClear();
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      lifecycleChannel.emit('logout');
    });

    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'unauthenticated',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-expiration', 'absent');
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-user', 'absent');
    expect(vi.getTimerCount()).toBe(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(waitForIdle).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lifecycleChannel.publishLogout).not.toHaveBeenCalled();
    expect(lifecycleChannel.publishSessionChanged).not.toHaveBeenCalled();
  });

  it('prevents a late local refresh from restoring authentication after remote logout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
    let resolveRefresh: ((response: RefreshResponse) => void) | undefined;
    const refresh = vi
      .fn<RefreshCoordinator['refresh']>()
      .mockRejectedValueOnce(invalidRefreshSession())
      .mockImplementationOnce(
        () =>
          new Promise<RefreshResponse>((resolve) => {
            resolveRefresh = resolve;
          }),
      );
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const lifecycleChannel = new TestAuthLifecycleChannel();
    renderProvider({ refresh }, { lifecycleChannel });
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);

    act(() => {
      lifecycleChannel.emit('logout');
    });
    resolveRefresh?.(refreshResponse('late-refresh-after-remote-logout'));
    await flushMicrotasks();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'unauthenticated',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps an already unauthenticated tab stable', async () => {
    const refresh = vi
      .fn<RefreshCoordinator['refresh']>()
      .mockRejectedValueOnce(invalidRefreshSession());
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    const lifecycleChannel = new TestAuthLifecycleChannel();
    renderProvider({ refresh }, { lifecycleChannel });
    await flushMicrotasks();

    act(() => {
      lifecycleChannel.emit('logout');
    });
    await flushMicrotasks();

    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'unauthenticated',
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lifecycleChannel.publishLogout).not.toHaveBeenCalled();
  });
});

describe('AuthenticationProvider refresh scheduling and visibility', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'cookie');
  });

  async function renderAuthenticatedWithTimer(
    proactiveResult: RefreshResponse | Error,
    expiresInMilliseconds = 120_000,
  ) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(currentUserResponse()));
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

  it('keeps the previous pair until proactive /me verification and commits the new pair together', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
    let resolveCurrentUser: ((response: Response) => void) | undefined;
    const currentUserPending = new Promise<Response>((resolve) => {
      resolveCurrentUser = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(currentUserPending);
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi
      .fn<RefreshCoordinator['refresh']>()
      .mockRejectedValueOnce(invalidRefreshSession())
      .mockResolvedValueOnce(refreshResponse('proactive-other-account-token', 180_000));
    const lifecycleChannel = new TestAuthLifecycleChannel();
    renderProvider({ refresh }, { lifecycleChannel });
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));
    await flushMicrotasks();
    lifecycleChannel.publishSessionChanged.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      headers: {
        Authorization: 'Bearer proactive-other-account-token',
      },
    });
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-token-kind',
      'explicit',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-user', user.email);

    resolveCurrentUser?.(currentUserResponse(200, otherUser));
    await flushMicrotasks();

    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-token-kind',
      'refreshed',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-user',
      otherUser.email,
    );
    expect(lifecycleChannel.publishSessionChanged).not.toHaveBeenCalled();
  });

  it('clears authentication when proactive refresh succeeds but /me fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(currentUserResponse(401));
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi
      .fn<RefreshCoordinator['refresh']>()
      .mockRejectedValueOnce(invalidRefreshSession())
      .mockResolvedValueOnce(refreshResponse('unverified-proactive-token', 180_000));
    renderProvider({ refresh });
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'unauthenticated',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-user', 'absent');
    expect(vi.getTimerCount()).toBe(0);
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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(currentUserResponse());
    vi.stubGlobal('fetch', fetchMock);
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: 'Bearer visibility-rotated-token',
      },
    });
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

describe('AuthenticationProvider logout coordination', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'cookie');
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: defaultLockManager,
    });
  });

  it('clears in-memory state immediately, cancels scheduling, and settles a 204 as unauthenticated', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
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
    let resolveLogout: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          order.push('logout-request');
          resolveLogout = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const waitForIdle = vi.fn().mockImplementation(async () => {
      order.push('local-refresh-idle');
    });
    const refresh = vi.fn().mockRejectedValue(invalidRefreshSession());
    const lifecycleChannel = new TestAuthLifecycleChannel();
    renderProvider({ refresh, waitForIdle }, { withLoginForm: true, lifecycleChannel });
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));
    await flushMicrotasks();
    lifecycleChannel.publishSessionChanged.mockClear();
    const timerCountBeforeLogout = vi.getTimerCount();
    expect(timerCountBeforeLogout).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'logging-out',
    );
    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-expiration', 'absent');
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-user', 'absent');
    expect(vi.getTimerCount()).toBeLessThan(timerCountBeforeLogout);
    expect(waitForIdle).toHaveBeenCalledTimes(1);
    expect(lifecycleChannel.publishLogout).not.toHaveBeenCalled();

    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['local-refresh-idle', 'lock-acquired', 'logout-request']);
    resolveLogout?.(new Response(null, { status: 204 }));
    await flushMicrotasks();

    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'unauthenticated',
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      'local-refresh-idle',
      'lock-acquired',
      'logout-request',
      'lock-released',
    ]);
    expect(lifecycleChannel.publishLogout).toHaveBeenCalledTimes(1);
    expect(lifecycleChannel.publishSessionChanged).not.toHaveBeenCalled();
  });

  it('waits for an in-flight refresh and ignores its late token before logging out', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
    let resolveRefresh: ((response: RefreshResponse) => void) | undefined;
    const requestRefresh = vi
      .fn<() => Promise<RefreshResponse>>()
      .mockRejectedValueOnce(invalidRefreshSession())
      .mockImplementationOnce(
        () =>
          new Promise<RefreshResponse>((resolve) => {
            resolveRefresh = resolve;
          }),
      );
    const coordinator = createRefreshCoordinator(requestRefresh);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    renderProvider(coordinator);
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(requestRefresh).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger logout' }));
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'logging-out',
    );
    expect(fetchMock).not.toHaveBeenCalled();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    fireEvent(document, new Event('visibilitychange'));
    expect(requestRefresh).toHaveBeenCalledTimes(2);

    resolveRefresh?.(refreshResponse('late-rotated-token', 180_000));
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/auth\/logout$/);
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'unauthenticated',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
    expect(document.body.innerHTML).not.toContain('late-rotated-token');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    [403, 'ORIGIN_NOT_ALLOWED'],
    [500, 'INTERNAL_SERVER_ERROR'],
  ])(
    'keeps local state cleared after HTTP %i and succeeds only after a manual retry',
    async (status, code) => {
      const failure = new Response(
        JSON.stringify({
          error: { code, message: 'Sanitized API error' },
          timestamp: new Date().toISOString(),
          path: '/api/v1/auth/logout',
          requestId: 'request-id',
        }),
        { status, headers: { 'Content-Type': 'application/json' } },
      );
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(failure)
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetchMock);
      const refresh = vi.fn().mockRejectedValue(invalidRefreshSession());
      renderProvider({ refresh }, { withLoginForm: true });
      await screen.findByLabelText('Email');
      fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));

      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

      expect(
        await screen.findByText(
          'We cleared this page’s session, but could not confirm sign-out with the server. Please retry before leaving this device.',
        ),
      ).toBeVisible();
      expect(screen.getByTestId('authentication-state')).toHaveAttribute(
        'data-status',
        'logout-error',
      );
      expect(screen.getByTestId('authentication-state')).toHaveAttribute(
        'data-access-token',
        'absent',
      );
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'Retry sign out' }));

      await waitFor(() =>
        expect(screen.getByTestId('authentication-state')).toHaveAttribute(
          'data-status',
          'unauthenticated',
        ),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Email')).toBeVisible();
    },
  );

  it('keeps memory clear after a network failure and does not retry automatically', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn().mockRejectedValue(invalidRefreshSession());
    renderProvider({ refresh }, { withLoginForm: true });
    await screen.findByLabelText('Email');
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Please retry sign-out' })).toBeVisible();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-user', 'absent');
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('fails closed and keeps local state clear when logout coordination is unavailable', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    renderProvider(
      { refresh: vi.fn().mockRejectedValue(invalidRefreshSession()) },
      { withLoginForm: true },
    );
    await screen.findByLabelText('Email');
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));
    await screen.findByRole('heading', { name: 'You are signed in' });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(
      await screen.findByRole('heading', {
        name: 'We could not safely coordinate your session',
      }),
    ).toBeVisible();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'coordination-error',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not duplicate a pending logout request', async () => {
    let resolveLogout: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveLogout = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderProvider({ refresh: vi.fn().mockRejectedValue(invalidRefreshSession()) });
    await flushMicrotasks();
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));

    fireEvent.click(screen.getByRole('button', { name: 'Trigger logout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trigger logout' }));
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveLogout?.(new Response(null, { status: 204 }));
    await flushMicrotasks();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'unauthenticated',
    );
  });

  it('does not let a pending restoration or its /me lookup restore state after logout intent', async () => {
    let resolveRefresh: ((response: RefreshResponse) => void) | undefined;
    const coordinator = createRefreshCoordinator(
      () =>
        new Promise<RefreshResponse>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    renderProvider(coordinator);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger logout' }));
    resolveRefresh?.(refreshResponse('stale-restoration-token'));
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/auth\/logout$/);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/auth/me'))).toBe(false);
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'unauthenticated',
    );
    expect(document.body.innerHTML).not.toContain('stale-restoration-token');
  });

  it('does not persist, render, broadcast, or read credentials while logging out', async () => {
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    const cookieRead = vi.fn(() => '');
    const cookieWrite = vi.fn();
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: cookieRead,
      set: cookieWrite,
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    renderProvider(
      { refresh: vi.fn().mockRejectedValue(invalidRefreshSession()) },
      { withLoginForm: true },
    );
    await screen.findByLabelText('Email');
    fireEvent.click(screen.getByRole('button', { name: 'Complete explicit login' }));
    await screen.findByRole('heading', { name: 'You are signed in' });

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByLabelText('Email');

    expect(storageWrite).not.toHaveBeenCalled();
    expect(cookieRead).not.toHaveBeenCalled();
    expect(cookieWrite).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain('explicit-login-token');
  });
});
