import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/api-client';
import type { RefreshCoordinator } from '@/lib/refresh-coordinator';
import { AuthenticationProvider, useAuthentication } from '@/providers/authentication-provider';
import { LoginForm } from './login-form';

const accessToken = 'test-only-memory-access-token';
const password = 'example-password';
const defaultLockManager = navigator.locks;

function futureTimestamp(milliseconds = 15 * 60_000) {
  return new Date(Date.now() + milliseconds).toISOString();
}

const loginResponse = {
  user: {
    id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
    firstName: 'Login',
    lastName: 'Response',
    email: 'meiir@example.com',
  },
  accessToken,
  get accessTokenExpiresAt() {
    return futureTimestamp();
  },
};
const currentUserResponse = {
  user: {
    id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
    firstName: 'Current',
    lastName: 'Customer',
    email: 'meiir@example.com',
  },
};

function renderForm(refreshCoordinator: RefreshCoordinator = invalidSessionCoordinator()) {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
    },
  });

  const rendered = render(
    <QueryClientProvider client={client}>
      <AuthenticationProvider refreshCoordinator={refreshCoordinator}>
        <LoginForm />
        <AuthenticationProbe />
      </AuthenticationProvider>
    </QueryClientProvider>,
  );

  return { ...rendered, client };
}

async function renderReadyForm(refreshCoordinator?: RefreshCoordinator) {
  const rendered = renderForm(refreshCoordinator);
  await screen.findByLabelText('Email');
  return rendered;
}

function invalidSessionCoordinator(): RefreshCoordinator {
  return {
    refresh: vi
      .fn()
      .mockRejectedValue(
        new ApiClientError('Session refresh failed', 401, 'INVALID_REFRESH_SESSION'),
      ),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
  };
}

function AuthenticationProbe() {
  const authentication = useAuthentication();

  return (
    <>
      <output
        data-testid="authentication-state"
        data-status={authentication.status}
        data-access-token={authentication.accessToken ? 'present' : 'absent'}
        data-expiration={authentication.accessTokenExpiresAt ? 'present' : 'absent'}
        data-user={authentication.currentUser?.email ?? 'absent'}
      />
      <button type="button" onClick={() => void authentication.logout()}>
        Test logout
      </button>
    </>
  );
}

function fillValidForm(email = '  MEIIR@EXAMPLE.COM  ') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

function successfulFetch() {
  return vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/login')) {
      return jsonResponse(loginResponse);
    }
    if (url.endsWith('/auth/me')) {
      return jsonResponse(currentUserResponse);
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
}

function apiError(status: number, code: string, message: string) {
  return jsonResponse(
    {
      error: { code, message },
      timestamp: '2026-07-28T12:00:00.000Z',
      path: '/api/v1/auth/login',
      requestId: 'request-id',
    },
    status,
  );
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('LoginForm', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'cookie');
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: defaultLockManager,
    });
  });

  it('renders accessible fields and navigation links', async () => {
    await renderReadyForm();

    expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getByRole('link', { name: 'Back to the public home page' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('shows shared-contract field errors for invalid email and missing password', async () => {
    await renderReadyForm();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'invalid' } });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Enter a valid email address')).toBeVisible();
    expect(screen.getByText('Password is required')).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('rejects a password longer than 128 characters', async () => {
    await renderReadyForm();
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'meiir@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'p'.repeat(129) },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByText('Password must contain at most 128 characters')).toBeVisible();
  });

  it('toggles password visibility with a real button and preserves the value', async () => {
    await renderReadyForm();
    const passwordInput = screen.getByLabelText('Password');
    fireEvent.change(passwordInput, { target: { value: password } });

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(passwordInput).toHaveValue(password);

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(passwordInput).toHaveValue(password);
  });

  it('shows an announced loading state and prevents duplicate submission', async () => {
    const loginResponsePending = new Promise<Response>(() => undefined);
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(loginResponsePending);
    vi.stubGlobal('fetch', fetchMock);
    await renderReadyForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const pendingButton = await screen.findByRole('button', { name: 'Signing in…' });
    expect(pendingButton).toBeDisabled();
    expect(screen.getByText('Signing in. Please wait.')).toBeInTheDocument();

    fireEvent.submit(pendingButton.closest('form') as HTMLFormElement);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normalizes and submits only the shared login fields with credentials included', async () => {
    const fetchMock = successfulFetch();
    vi.stubGlobal('fetch', fetchMock);
    await renderReadyForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('You are signed in');

    const loginCall = fetchMock.mock.calls[0];
    expect(loginCall?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    });
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({
      email: 'meiir@example.com',
      password,
    });
  });

  it('starts login transport only after acquiring the shared cookie-mutation lock', async () => {
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
      vi.fn<typeof fetch>().mockImplementation(async (input) => {
        if (String(input).endsWith('/auth/login')) {
          order.push('login-request');
          return jsonResponse(loginResponse);
        }

        order.push('me-request');
        return jsonResponse(currentUserResponse);
      }),
    );
    await renderReadyForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('You are signed in');

    expect(order).toEqual(['lock-acquired', 'login-request', 'lock-released', 'me-request']);
  });

  it('fails closed with an accessible coordination message when Web Locks are unavailable', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    await renderReadyForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', {
        name: 'We could not safely coordinate your session',
      }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your browser could not safely coordinate the sign-in session.',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'coordination-error',
    );
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to sign in' }));
    expect(await screen.findByLabelText('Email')).toBeVisible();
  });

  it('stages the token only in memory, verifies /me, and displays its current user', async () => {
    let resolveCurrentUser: ((response: Response) => void) | undefined;
    const currentUserPending = new Promise<Response>((resolve) => {
      resolveCurrentUser = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      if (String(input).endsWith('/auth/login')) {
        return jsonResponse(loginResponse);
      }
      return currentUserPending;
    });
    vi.stubGlobal('fetch', fetchMock);
    const { client } = await renderReadyForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByTestId('authentication-state')).toHaveAttribute(
        'data-status',
        'authenticating',
      );
      expect(screen.getByTestId('authentication-state')).toHaveAttribute(
        'data-access-token',
        'present',
      );
    });

    const currentUserCall = fetchMock.mock.calls[1];
    expect(currentUserCall?.[1]).toMatchObject({
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });

    resolveCurrentUser?.(jsonResponse(currentUserResponse));

    expect(await screen.findByText('You are signed in')).toBeVisible();
    expect(screen.getByText('Current Customer')).toBeVisible();
    expect(screen.getByText('meiir@example.com')).toBeVisible();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'authenticated',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-user',
      'meiir@example.com',
    );

    const mutationState = JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state),
    );
    expect(mutationState).not.toContain(accessToken);
    expect(mutationState).not.toContain(password);
    expect(document.body.innerHTML).not.toContain(accessToken);
  });

  it('shows a focused generic invalid-credentials error and does not call /me', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(apiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'));
    vi.stubGlobal('fetch', fetchMock);
    await renderReadyForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const error = await screen.findByText('Email or password is incorrect.');
    expect(error).toHaveFocus();
    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveValue(''));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
  });

  it.each([
    {
      name: 'a server error',
      response: () => apiError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred'),
    },
    {
      name: 'an invalid successful login response',
      response: () => jsonResponse({ user: loginResponse.user }),
    },
  ])('shows a generic error for $name without calling /me', async ({ response }) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    await renderReadyForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('We could not sign you in. Please try again.')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
  });

  it.each([
    {
      name: 'authentication-required',
      response: () => apiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required'),
    },
    {
      name: 'unexpected',
      response: () => apiError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred'),
    },
    {
      name: 'invalid response',
      response: () => jsonResponse({ user: { id: 'invalid' } }),
    },
  ])('clears authentication and shows a session error when /me is $name', async ({ response }) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(loginResponse))
      .mockResolvedValueOnce(response());
    vi.stubGlobal('fetch', fetchMock);
    await renderReadyForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByText('We could not establish your session. Please sign in again.'),
    ).toBeVisible();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-status', 'error');
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-expiration', 'absent');
    expect(screen.getByTestId('authentication-state')).toHaveAttribute('data-user', 'absent');
    expect(fetchMock.mock.calls.every(([input]) => !String(input).endsWith('/auth/refresh'))).toBe(
      true,
    );
  });

  it('handles a network failure without leaking request data', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network offline'));
    vi.stubGlobal('fetch', fetchMock);
    await renderReadyForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const error = await screen.findByText('We could not sign you in. Please try again.');
    expect(error).toBeVisible();
    expect(error).not.toHaveTextContent(password);
    expect(error).not.toHaveTextContent(accessToken);
  });

  it('does not use browser persistence, cookies, IndexedDB, or rendered HTML for secrets', async () => {
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
    vi.stubGlobal('fetch', successfulFetch());
    await renderReadyForm();
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('You are signed in');

    expect(storageWrite).not.toHaveBeenCalled();
    expect(indexedDatabaseOpen).not.toHaveBeenCalled();
    expect(cookieRead).not.toHaveBeenCalled();
    expect(cookieWrite).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain(accessToken);
    expect(document.body.innerHTML).not.toContain(password);
    expect(document.body.innerHTML).not.toContain('washqueue_refresh');
  });

  it('resolves an invalid startup session to the login form after remounting', async () => {
    const fetchMock = successfulFetch();
    vi.stubGlobal('fetch', fetchMock);
    const firstRender = await renderReadyForm();
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('You are signed in');

    firstRender.unmount();
    await renderReadyForm();

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'unauthenticated',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('prevents a stale explicit-login result from restoring state after logout', async () => {
    let resolveLogin: ((response: Response) => void) | undefined;
    const loginRequest = new Promise<Response>((resolve) => {
      resolveLogin = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) {
        return loginRequest;
      }
      if (url.endsWith('/auth/logout')) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected test request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderReadyForm();
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(screen.getByTestId('authentication-state')).toHaveAttribute(
        'data-status',
        'authenticating',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Test logout' }));
    await waitFor(() =>
      expect(screen.getByTestId('authentication-state')).toHaveAttribute(
        'data-status',
        'unauthenticated',
      ),
    );

    await act(async () => {
      resolveLogin?.(jsonResponse(loginResponse));
      await loginRequest;
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeDisabled());

    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/auth/me'))).toBe(false);
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-status',
      'unauthenticated',
    );
    expect(screen.getByTestId('authentication-state')).toHaveAttribute(
      'data-access-token',
      'absent',
    );
    expect(document.body.innerHTML).not.toContain(accessToken);
  });
});
