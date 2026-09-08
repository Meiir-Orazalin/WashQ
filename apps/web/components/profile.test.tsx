import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CurrentUserResponse, RefreshResponse } from '@washqueue/contracts';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/lib/api-client';
import type { AuthLifecycleChannel, AuthLifecycleEvent } from '@/lib/auth-lifecycle-channel';
import { AuthenticationProvider, useAuthentication } from '@/providers/authentication-provider';
import { Profile } from './profile';

const userA = {
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Alpha',
  lastName: 'Customer',
  email: 'a@example.invalid',
};
const userB = {
  ...userA,
  id: 'ef4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Beta',
  email: 'b@example.invalid',
};
const refreshed = (token = 'test-only-alpha-token'): RefreshResponse => ({
  accessToken: token,
  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setup(refresh = vi.fn().mockResolvedValue(refreshed())) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let listener: ((event: AuthLifecycleEvent) => void) | undefined;
  let auth!: ReturnType<typeof useAuthentication>;
  const channel: AuthLifecycleChannel = {
    publishProfileChanged: vi.fn(),
    publishSessionChanged: vi.fn(),
    publishLogout: vi.fn(),
    close: vi.fn(),
    subscribe: (callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  const channelFactory = () => channel;
  const coordinator = { refresh, waitForIdle: vi.fn().mockResolvedValue(undefined) };
  const me = vi.spyOn(api, 'getCurrentUser').mockImplementation(async (token) => ({
    user: token === 'test-only-beta-token' ? userB : userA,
  }));
  function Probe() {
    const value = useAuthentication();
    useEffect(() => {
      auth = value;
    }, [value]);
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <AuthenticationProvider
        refreshCoordinator={coordinator}
        lifecycleChannelFactory={channelFactory}
      >
        <Probe />
        <Profile />
      </AuthenticationProvider>
    </QueryClientProvider>,
  );
  return {
    client,
    refresh,
    channel,
    me,
    get auth() {
      return auth;
    },
    emit(type: AuthLifecycleEvent['type']) {
      act(() => listener?.({ type, sourceId: 'remote-document' }));
    },
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const edit = async () =>
  fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));
const changeFirst = (value = 'Updated') =>
  fireEvent.change(screen.getByLabelText('First name'), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

describe('profile UI and authoritative provider lifecycle', () => {
  it('preserves a newer profile projection when an older proactive me read commits a rotated token', async () => {
    vi.useFakeTimers();
    const result = setup();
    await act(async () => {
      await Promise.resolve();
    });
    const pending = deferred<CurrentUserResponse>();
    result.me.mockReturnValueOnce(pending.promise);
    result.refresh.mockImplementationOnce(async () => refreshed('test-only-rotated-token'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(840_000);
    });
    expect(result.me).toHaveBeenCalledTimes(2);
    await act(async () => {
      await result.auth.runWithCurrentUserUpdate(async () => ({
        user: { ...userA, firstName: 'Updated' },
      }));
    });
    await act(async () => pending.resolve({ user: userA }));
    expect(result.auth.currentUser?.firstName).toBe('Updated');
    expect(
      await result.auth.runWithAccessToken(async (token) => token === 'test-only-rotated-token'),
    ).toBe(true);
    expect(result.channel.publishProfileChanged).toHaveBeenCalledTimes(1);
  });

  it('a current mutation 401 removes protected UI without retry or a profile event', async () => {
    const update = vi
      .spyOn(api, 'updateCurrentUserProfile')
      .mockRejectedValue(new api.ApiClientError('safe', 401, 'AUTHENTICATION_REQUIRED'));
    const result = setup();
    await edit();
    changeFirst();
    save();
    await waitFor(() => expect(result.auth.status).toBe('unauthenticated'));
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.refresh).toHaveBeenCalledTimes(1);
    expect(result.channel.publishProfileChanged).not.toHaveBeenCalled();
  });

  it('shows semantic names/read-only email, prefilled accessible controls, focus and cancel without transport', async () => {
    const update = vi.spyOn(api, 'updateCurrentUserProfile');
    setup();
    expect(await screen.findByText(userA.email)).toBeVisible();
    expect(screen.getByText('Alpha').tagName).toBe('DD');
    await edit();
    expect(screen.getByLabelText('First name')).toHaveValue('Alpha');
    expect(screen.getByLabelText('First name')).toHaveFocus();
    expect(screen.getByLabelText('Last name (optional)')).toHaveValue('Customer');
    expect(screen.getByLabelText('Email (read-only)')).toHaveAttribute('readonly');
    changeFirst();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit profile' })).toHaveFocus();
    expect(screen.getByText('Alpha')).toBeVisible();
    expect(update).not.toHaveBeenCalled();
  });
  it('validates empty/invalid changes with associated field errors', async () => {
    const update = vi.spyOn(api, 'updateCurrentUserProfile');
    setup();
    await edit();
    save();
    expect(screen.getByRole('alert')).toHaveTextContent('Change at least one name');
    changeFirst('A');
    save();
    expect(screen.getByLabelText('First name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('First name')).toHaveAccessibleDescription(
      'First name must contain at least 2 characters',
    );
    expect(update).not.toHaveBeenCalled();
  });
  it('commits normalized changed names locally, clears last name, preserves token and emits exactly one profile event', async () => {
    const update = vi
      .spyOn(api, 'updateCurrentUserProfile')
      .mockResolvedValue({ user: { ...userA, firstName: 'Updated', lastName: null } });
    const result = setup();
    await edit();
    const expiration = result.auth.accessTokenExpiresAt;
    changeFirst(' Updated ');
    fireEvent.change(screen.getByLabelText('Last name (optional)'), { target: { value: ' ' } });
    save();
    expect(await screen.findByText('Profile updated.')).toBeVisible();
    expect(screen.getByText('Updated')).toBeVisible();
    expect(screen.queryByText('Customer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit profile' })).toHaveFocus();
    expect(update).toHaveBeenCalledExactlyOnceWith(
      'test-only-alpha-token',
      { firstName: 'Updated', lastName: null },
      expect.any(AbortSignal),
    );
    expect(result.auth.currentUser?.lastName).toBeNull();
    expect(result.auth.accessTokenExpiresAt).toBe(expiration);
    expect(
      await result.auth.runWithAccessToken(async (token) => token === 'test-only-alpha-token'),
    ).toBe(true);
    expect(result.channel.publishProfileChanged).toHaveBeenCalledTimes(1);
    expect(result.channel.publishSessionChanged).not.toHaveBeenCalled();
    expect(result.refresh).toHaveBeenCalledTimes(1);
    expect(result.client.getQueryCache().getAll()).toEqual([]);
    expect(result.client.getMutationCache().getAll()).toEqual([]);
    expect(document.body.innerHTML.includes('test-only-alpha-token')).toBe(false);
    expect(result.auth).not.toHaveProperty('accessToken');
  });
  it('announces pending, disables duplicate submissions and shows sanitized failures', async () => {
    const pending = deferred<CurrentUserResponse>();
    const update = vi.spyOn(api, 'updateCurrentUserProfile').mockReturnValue(pending.promise);
    const result = setup();
    await edit();
    changeFirst();
    save();
    fireEvent.submit(screen.getByRole('form', { name: 'Edit profile' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByText('Saving your profile…')).toHaveAttribute('role', 'status');
    await act(async () => pending.reject(new Error('private-database-token-details')));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not update your profile. Please try again.',
    );
    expect(document.body.innerHTML).not.toContain('private-database-token-details');
    expect(result.auth.currentUser).toEqual(userA);
    expect(result.channel.publishProfileChanged).not.toHaveBeenCalled();
  });
  it('remote profile notification uses only me with the current token, updates names and never refreshes/rebroadcasts', async () => {
    const result = setup();
    await screen.findByText('Alpha');
    result.me.mockResolvedValueOnce({ user: { ...userA, firstName: 'Remote' } });
    result.emit('profile-changed');
    expect(await screen.findByText('Remote')).toBeVisible();
    expect(result.me).toHaveBeenLastCalledWith('test-only-alpha-token');
    expect(result.me).toHaveBeenCalledTimes(2);
    expect(result.refresh).toHaveBeenCalledTimes(1);
    expect(result.channel.publishProfileChanged).not.toHaveBeenCalled();
    expect(result.channel.publishSessionChanged).not.toHaveBeenCalled();
  });
  it.each([401, 500])(
    'clears protected state on authoritative remote me %s without retry',
    async (status) => {
      const result = setup();
      await edit();
      result.me.mockRejectedValueOnce(
        new api.ApiClientError(
          'safe',
          status,
          status === 401 ? 'AUTHENTICATION_REQUIRED' : 'INTERNAL_SERVER_ERROR',
        ),
      );
      result.emit('profile-changed');
      await waitFor(() =>
        expect(result.auth.status).toBe(status === 401 ? 'unauthenticated' : 'error'),
      );
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
      expect(result.me).toHaveBeenCalledTimes(2);
      expect(result.refresh).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['success', '401', '500'] as const)(
    'ignores stale user-A update %s after account switching, without B feedback or logout',
    async (outcome) => {
      const pending = deferred<CurrentUserResponse>();
      vi.spyOn(api, 'updateCurrentUserProfile').mockReturnValue(pending.promise);
      const result = setup();
      await edit();
      changeFirst('OldResult');
      save();
      const switching = deferred<RefreshResponse>();
      result.refresh.mockReturnValueOnce(switching.promise);
      result.emit('session-changed');
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
      expect(screen.getByText('Updating your session…')).toBeVisible();
      await act(async () => switching.resolve(refreshed('test-only-beta-token')));
      expect(await screen.findByText('Beta')).toBeVisible();
      await act(async () => {
        if (outcome === 'success') pending.resolve({ user: { ...userA, firstName: 'OldResult' } });
        else
          pending.reject(
            new api.ApiClientError(
              'safe',
              Number(outcome),
              outcome === '401' ? 'AUTHENTICATION_REQUIRED' : 'INTERNAL_SERVER_ERROR',
            ),
          );
      });
      expect(result.auth.currentUser).toEqual(userB);
      expect(result.auth.status).toBe('authenticated');
      expect(screen.queryByText('OldResult')).not.toBeInTheDocument();
      expect(screen.queryByText('Profile updated.')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(result.channel.publishProfileChanged).not.toHaveBeenCalled();
    },
  );
  it.each(['success', '401', '500'] as const)(
    'ignores stale remote profile read %s after newer login',
    async (outcome) => {
      const result = setup();
      await screen.findByText('Alpha');
      const pending = deferred<CurrentUserResponse>();
      result.me.mockReturnValueOnce(pending.promise);
      result.emit('profile-changed');
      act(() => {
        const generation = result.auth.beginAuthentication();
        if (generation !== null)
          result.auth.completeAuthentication(
            'test-only-beta-token',
            refreshed().accessTokenExpiresAt,
            userB,
            generation,
          );
      });
      expect(await screen.findByText('Beta')).toBeVisible();
      await act(async () => {
        if (outcome === 'success') pending.resolve({ user: userA });
        else
          pending.reject(
            new api.ApiClientError(
              'safe',
              Number(outcome),
              outcome === '401' ? 'AUTHENTICATION_REQUIRED' : 'INTERNAL_SERVER_ERROR',
            ),
          );
      });
      expect(result.auth.currentUser).toEqual(userB);
      expect(result.auth.status).toBe('authenticated');
    },
  );
  it('remote logout removes edit state and suppresses delayed local success and future profile reads', async () => {
    const pending = deferred<CurrentUserResponse>();
    vi.spyOn(api, 'updateCurrentUserProfile').mockReturnValue(pending.promise);
    const result = setup();
    await edit();
    changeFirst();
    save();
    result.emit('logout');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    await act(async () => pending.resolve({ user: { ...userA, firstName: 'Updated' } }));
    result.emit('profile-changed');
    expect(result.auth.status).toBe('unauthenticated');
    expect(result.me).toHaveBeenCalledTimes(1);
    expect(result.channel.publishProfileChanged).not.toHaveBeenCalled();
  });
  it('ignores an older remote read after a successful local update', async () => {
    const result = setup();
    await edit();
    const pending = deferred<CurrentUserResponse>();
    result.me.mockReturnValueOnce(pending.promise);
    result.emit('profile-changed');
    vi.spyOn(api, 'updateCurrentUserProfile').mockResolvedValue({
      user: { ...userA, firstName: 'Updated' },
    });
    changeFirst();
    save();
    await screen.findByText('Profile updated.');
    await act(async () => pending.resolve({ user: userA }));
    expect(result.auth.currentUser?.firstName).toBe('Updated');
  });
  it('rejects an update response for a different user or with internal fields', async () => {
    const result = setup();
    await screen.findByText('Alpha');
    await expect(
      result.auth.runWithCurrentUserUpdate(async () => ({ user: userB })),
    ).rejects.toThrow('invalid current-user response');
    const invalid = { user: { ...userA, passwordHash: 'internal' } };
    await expect(result.auth.runWithCurrentUserUpdate(async () => invalid)).rejects.toThrow(
      'invalid current-user response',
    );
    expect(result.auth.currentUser).toEqual(userA);
    expect(result.channel.publishProfileChanged).not.toHaveBeenCalled();
  });
  it('initializing and synchronizing never show profile; unauthenticated offers safe links', async () => {
    const pending = deferred<RefreshResponse>();
    const result = setup(vi.fn().mockReturnValue(pending.promise));
    expect(screen.getByText('Restoring your session…')).toBeVisible();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    await act(async () =>
      pending.reject(new api.ApiClientError('safe', 401, 'INVALID_REFRESH_SESSION')),
    );
    expect(await screen.findByText('Sign in to view and edit your profile.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
    result.emit('profile-changed');
    expect(result.me).not.toHaveBeenCalled();
  });
});
