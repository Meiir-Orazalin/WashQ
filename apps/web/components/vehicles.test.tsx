import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { RefreshResponse, VehicleListResponse } from '@washqueue/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/lib/api-client';
import * as vehiclesApi from '@/lib/vehicle-api-client';
import type { AuthLifecycleChannel, AuthLifecycleEvent } from '@/lib/auth-lifecycle-channel';
import { AuthenticationProvider, useAuthentication } from '@/providers/authentication-provider';
import { vehicleQueryKey } from '@/hooks/use-vehicles';
import { Vehicles } from './vehicles';

const userA = {
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Alpha',
  lastName: null,
  email: 'a@example.invalid',
};
const userB = {
  ...userA,
  id: 'ef4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Beta',
  email: 'b@example.invalid',
};
const vehicleA = {
  id: '00000000-0000-4000-8000-000000000001',
  make: 'Toyota',
  model: 'Camry',
  plateNumber: 'ALPHA123',
  color: null,
  productionYear: null,
  createdAt: '2026-09-07T10:00:00Z',
  updatedAt: '2026-09-07T10:00:00Z',
};
const vehicleB = {
  ...vehicleA,
  id: '00000000-0000-4000-8000-000000000002',
  plateNumber: 'BETA123',
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
  let auth: ReturnType<typeof useAuthentication>;
  const channel: AuthLifecycleChannel = {
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
  vi.spyOn(api, 'getCurrentUser').mockImplementation(async (token) => ({
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
        <Vehicles />
      </AuthenticationProvider>
    </QueryClientProvider>,
  );
  return {
    client,
    refresh,
    get auth() {
      return auth;
    },
    emit(type: AuthLifecycleEvent['type']) {
      act(() => listener?.({ type, sourceId: 'other-document' }));
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('vehicles authenticated UI and cache isolation', () => {
  it('hides form and data during initialization, then shows empty state and accessible labels', async () => {
    const pending = deferred<RefreshResponse>();
    vi.spyOn(vehiclesApi, 'listVehicles').mockResolvedValue({ vehicles: [] });
    setup(vi.fn().mockReturnValue(pending.promise));
    expect(screen.getByText('Restoring your session…')).toBeVisible();
    expect(screen.queryByLabelText('Make')).not.toBeInTheDocument();
    await act(async () => pending.resolve(refreshed()));
    await screen.findByText('No vehicles yet. Add your first vehicle.');
    for (const label of [
      'Make',
      'Model',
      'Plate number',
      'Production year (optional)',
      'Color (optional)',
    ])
      expect(screen.getByLabelText(label)).toBeVisible();
  });
  it('shows sign-in and home links without protected requests for unauthenticated visitors', async () => {
    const list = vi.spyOn(vehiclesApi, 'listVehicles');
    setup(
      vi
        .fn()
        .mockRejectedValue(new api.ApiClientError('No session', 401, 'INVALID_REFRESH_SESSION')),
    );
    await screen.findByText('Sign in to add and view your vehicles.');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
    expect(list).not.toHaveBeenCalled();
  });
  it('validates form, prevents duplicates in flight, resets after success and invalidates the list', async () => {
    const list = vi.spyOn(vehiclesApi, 'listVehicles').mockResolvedValue({ vehicles: [] });
    const pending = deferred<{ vehicle: typeof vehicleA }>();
    const create = vi.spyOn(vehiclesApi, 'createVehicle').mockReturnValue(pending.promise);
    setup();
    const submit = await screen.findByRole('button', { name: 'Add vehicle' });
    fireEvent.click(submit);
    expect(screen.getByLabelText('Make')).toHaveAttribute('aria-invalid', 'true');
    expect(create).not.toHaveBeenCalled();
    for (const [label, value] of [
      ['Make', ' Toyota '],
      ['Model', 'Camry'],
      ['Plate number', 'alpha-123'],
    ] as const)
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.change(screen.getByLabelText('Production year (optional)'), {
      target: { value: '2024.5' },
    });
    fireEvent.click(submit);
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Production year (optional)'), {
      target: { value: '' },
    });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(create.mock.calls[0]?.[1]).toMatchObject({
      make: 'Toyota',
      plateNumber: 'ALPHA123',
      productionYear: null,
      color: null,
    });
    list.mockResolvedValue({ vehicles: [vehicleA] });
    await act(async () => pending.resolve({ vehicle: vehicleA }));
    await screen.findByText('Vehicle added.');
    await screen.findByText('ALPHA123');
    expect(screen.getByLabelText('Make')).toHaveValue('');
  });
  it.each([
    new api.ApiClientError('Duplicate', 409, 'VEHICLE_ALREADY_EXISTS'),
    new api.ApiClientError('private detail', 500),
  ])('shows safe create errors', async (failure) => {
    vi.spyOn(vehiclesApi, 'listVehicles').mockResolvedValue({ vehicles: [] });
    vi.spyOn(vehiclesApi, 'createVehicle').mockRejectedValue(failure);
    setup();
    await screen.findByLabelText('Make');
    for (const [label, value] of [
      ['Make', 'Toyota'],
      ['Model', 'Camry'],
      ['Plate number', 'ALPHA123'],
    ] as const)
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Add vehicle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      failure.status === 409 ? 'already have a vehicle' : 'could not save',
    );
    expect(document.body.textContent).not.toContain('private detail');
  });
  it('shows loading, populated semantic list, and safe list failures without automatic retries', async () => {
    const pending = deferred<VehicleListResponse>();
    const list = vi.spyOn(vehiclesApi, 'listVehicles').mockReturnValue(pending.promise);
    const view = setup();
    await screen.findByText('Loading your vehicles…');
    await act(async () =>
      pending.resolve({ vehicles: [{ ...vehicleA, productionYear: 2024, color: 'Black' }] }),
    );
    expect(await screen.findByRole('listitem')).toHaveTextContent('ALPHA123');
    expect(screen.getByText('Year: 2024')).toBeVisible();
    list.mockRejectedValue(new api.ApiClientError('private error', 500));
    await act(async () => {
      await view.client.refetchQueries({ queryKey: vehicleQueryKey(userA.id) });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('could not load');
    expect(screen.queryByText('ALPHA123')).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
  it('removes previous-user cache immediately and cannot show a delayed A response as B', async () => {
    const stale = deferred<VehicleListResponse>();
    const synchronize = deferred<RefreshResponse>();
    const list = vi
      .spyOn(vehiclesApi, 'listVehicles')
      .mockResolvedValueOnce({ vehicles: [vehicleA] })
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValue({ vehicles: [vehicleB] });
    const view = setup();
    await screen.findByText('ALPHA123');
    let refetch!: Promise<void>;
    act(() => {
      refetch = view.client.refetchQueries({ queryKey: vehicleQueryKey(userA.id) });
    });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    view.refresh.mockReturnValueOnce(synchronize.promise);
    view.emit('session-changed');
    expect(screen.getByText('Updating your session…')).toBeVisible();
    expect(screen.queryByText('ALPHA123')).not.toBeInTheDocument();
    expect(view.client.getQueryData(vehicleQueryKey(userA.id))).toBeUndefined();
    expect(list.mock.calls[1]?.[1]?.aborted).toBe(true);
    await act(async () => synchronize.resolve(refreshed('test-only-beta-token')));
    await screen.findByText('BETA123');
    await act(async () => {
      stale.resolve({ vehicles: [vehicleA] });
      await refetch;
    });
    expect(screen.queryByText('ALPHA123')).not.toBeInTheDocument();
    expect(view.client.getQueryData(vehicleQueryKey(userA.id))).toBeUndefined();
    expect(
      view.client
        .getQueryCache()
        .getAll()
        .map(({ queryKey }) => queryKey),
    ).toEqual([vehicleQueryKey(userB.id)]);
    const cacheAndMarkup = JSON.stringify([
      view.client
        .getQueryCache()
        .getAll()
        .map(({ queryKey, state }) => ({ queryKey, state })),
      view.client
        .getMutationCache()
        .getAll()
        .map(({ state }) => state),
      document.body.innerHTML,
    ]);
    expect(cacheAndMarkup).not.toMatch(/test-only-alpha-token|test-only-beta-token|ALPHA123/);
    expect(view.auth).not.toHaveProperty('accessToken');
  });
  it('clears vehicles immediately during logout and keeps them hidden after logout failure', async () => {
    vi.spyOn(vehiclesApi, 'listVehicles').mockResolvedValue({ vehicles: [vehicleA] });
    const logout = deferred<undefined>();
    vi.spyOn(api, 'logoutCurrentSession').mockReturnValue(logout.promise);
    const view = setup();
    await screen.findByText('ALPHA123');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.queryByText('ALPHA123')).not.toBeInTheDocument();
    expect(view.client.getQueryData(vehicleQueryKey(userA.id))).toBeUndefined();
    await act(async () => logout.reject(new api.ApiClientError('Failed', 500)));
    await screen.findByText('Please retry sign-out');
    expect(screen.queryByLabelText('Make')).not.toBeInTheDocument();
  });
  it('clears protected UI and cache on generic 401 with no refresh/retry', async () => {
    const list = vi
      .spyOn(vehiclesApi, 'listVehicles')
      .mockResolvedValueOnce({ vehicles: [vehicleA] })
      .mockRejectedValue(
        new api.ApiClientError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'),
      );
    const view = setup();
    await screen.findByText('ALPHA123');
    await act(async () => {
      await view.client.refetchQueries({ queryKey: vehicleQueryKey(userA.id) });
    });
    await screen.findByText('Sign in to add and view your vehicles.');
    expect(view.client.getQueryData(vehicleQueryKey(userA.id))).toBeUndefined();
    expect(screen.queryByText('ALPHA123')).not.toBeInTheDocument();
    expect(view.refresh).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
  });
  it('rejects a saved old-identity callback and ignores stale 401 after an account switch', async () => {
    vi.spyOn(vehiclesApi, 'listVehicles').mockResolvedValue({ vehicles: [] });
    const view = setup();
    await screen.findByLabelText('Make');
    const oldRun = view.auth.runWithAccessToken;
    const stale = deferred<undefined>();
    const oldRequest = oldRun(() => stale.promise).catch(() => undefined);
    view.refresh.mockResolvedValueOnce(refreshed('test-only-beta-token'));
    view.emit('session-changed');
    await screen.findByText(userB.email);
    const operation = vi.fn();
    await expect(oldRun(operation)).rejects.toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(operation).not.toHaveBeenCalled();
    await act(async () => {
      stale.reject(new api.ApiClientError('Required', 401, 'AUTHENTICATION_REQUIRED'));
      await oldRequest;
    });
    expect(screen.getByText(userB.email)).toBeVisible();
  });
});
