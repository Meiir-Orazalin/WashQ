import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    publishProfileChanged: vi.fn(),
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
  it('opens a prefilled accessible edit form, focuses Make, and cancels without a request', async () => {
    vi.spyOn(vehiclesApi, 'listVehicles').mockResolvedValue({
      vehicles: [{ ...vehicleA, productionYear: 2024, color: 'Black' }],
    });
    const update = vi.spyOn(vehiclesApi, 'updateVehicle');
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Edit vehicle' }));
    expect(form.getByLabelText('Make')).toHaveValue('Toyota');
    expect(form.getByLabelText('Make')).toHaveFocus();
    expect(form.getByLabelText('Model')).toHaveValue('Camry');
    expect(form.getByLabelText('Plate number')).toHaveValue('ALPHA123');
    expect(form.getByLabelText('Production year (optional)')).toHaveValue('2024');
    expect(form.getByLabelText('Color (optional)')).toHaveValue('Black');
    fireEvent.click(form.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Edit vehicle' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
    expect(update).not.toHaveBeenCalled();
  });
  it('validates an intended partial edit, prevents duplicate submits and refetches canonical values', async () => {
    const list = vi.spyOn(vehiclesApi, 'listVehicles').mockResolvedValue({ vehicles: [vehicleA] });
    const pending = deferred<{ vehicle: typeof vehicleA }>();
    const update = vi.spyOn(vehiclesApi, 'updateVehicle').mockReturnValue(pending.promise);
    const view = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Edit vehicle' }));
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    expect(form.getByRole('alert')).toHaveTextContent('Change at least one field');
    fireEvent.change(form.getByLabelText('Plate number'), { target: { value: 'invalid/' } });
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    expect(form.getByLabelText('Plate number')).toHaveAttribute('aria-invalid', 'true');
    expect(form.getByLabelText('Plate number')).toHaveAccessibleDescription(
      'Use only letters and digits',
    );
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(form.getByLabelText('Plate number'), { target: { value: ' new-123 ' } });
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Edit vehicle' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[2]).toEqual({ plateNumber: 'NEW123' });
    expect(form.getByRole('button', { name: 'Saving changes…' })).toBeDisabled();
    expect(form.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    const changed = { ...vehicleA, plateNumber: 'NEW123' };
    list.mockResolvedValue({ vehicles: [changed] });
    await act(async () => pending.resolve({ vehicle: changed }));
    await screen.findByText('NEW123');
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Edit vehicle' })).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Vehicle updated.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
    const cache = JSON.stringify([
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
    expect(cache).not.toMatch(/test-only-alpha-token|test-only-beta-token/);
  });
  it('clears optional edit controls to null and rejects decimal years', async () => {
    vi.spyOn(vehiclesApi, 'listVehicles').mockResolvedValue({
      vehicles: [{ ...vehicleA, productionYear: 2024, color: 'Black' }],
    });
    const update = vi.spyOn(vehiclesApi, 'updateVehicle').mockResolvedValue({ vehicle: vehicleA });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Edit vehicle' }));
    fireEvent.change(form.getByLabelText('Production year (optional)'), {
      target: { value: '2024.5' },
    });
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    expect(form.getByLabelText('Production year (optional)')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(form.getByLabelText('Production year (optional)'), { target: { value: '' } });
    fireEvent.change(form.getByLabelText('Color (optional)'), { target: { value: ' ' } });
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[2]).toEqual({ productionYear: null, color: null });
  });
  it.each([409, 500])('keeps a safe edit form after %s with no automatic retry', async (status) => {
    vi.spyOn(vehiclesApi, 'listVehicles').mockResolvedValue({ vehicles: [vehicleA] });
    const update = vi
      .spyOn(vehiclesApi, 'updateVehicle')
      .mockRejectedValue(
        new api.ApiClientError(
          'private-detail',
          status,
          status === 409 ? 'VEHICLE_ALREADY_EXISTS' : 'INTERNAL_SERVER_ERROR',
        ),
      );
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Edit vehicle' }));
    fireEvent.change(form.getByLabelText('Model'), { target: { value: 'Hybrid' } });
    fireEvent.click(form.getByRole('button', { name: 'Save' }));
    expect(await form.findByRole('alert')).toHaveTextContent(
      status === 409 ? 'already have a vehicle' : 'could not change',
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('private-detail');
  });
  it('confirms deletion explicitly, cancels without a request, and removes the row on 204', async () => {
    const list = vi.spyOn(vehiclesApi, 'listVehicles').mockResolvedValue({ vehicles: [vehicleA] });
    const pending = deferred<undefined>();
    const deletion = vi.spyOn(vehiclesApi, 'deleteVehicle').mockReturnValue(pending.promise);
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(
      screen.getByRole('group', { name: 'Delete this vehicle? This cannot be undone.' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deletion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const confirm = screen.getByRole('button', { name: 'Confirm delete' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(deletion).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    list.mockResolvedValue({ vehicles: [] });
    await act(async () => pending.resolve(undefined));
    await screen.findByText('Vehicle deleted.');
    await screen.findByText('No vehicles yet. Add your first vehicle.');
    expect(screen.getByRole('heading', { name: 'Your vehicles' })).toHaveFocus();
  });
  it.each(['update', 'delete'] as const)(
    'invalidates a stale row after %s 404 with a generic message',
    async (operation) => {
      const list = vi
        .spyOn(vehiclesApi, 'listVehicles')
        .mockResolvedValue({ vehicles: [vehicleA] });
      vi.spyOn(vehiclesApi, 'updateVehicle').mockRejectedValue(
        new api.ApiClientError('not-owned details', 404, 'VEHICLE_NOT_FOUND'),
      );
      vi.spyOn(vehiclesApi, 'deleteVehicle').mockRejectedValue(
        new api.ApiClientError('not-owned details', 404, 'VEHICLE_NOT_FOUND'),
      );
      setup();
      await screen.findByText('ALPHA123');
      list.mockResolvedValue({ vehicles: [] });
      if (operation === 'update') {
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        const form = within(screen.getByRole('form', { name: 'Edit vehicle' }));
        fireEvent.change(form.getByLabelText('Model'), { target: { value: 'Hybrid' } });
        fireEvent.click(form.getByRole('button', { name: 'Save' }));
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
      }
      await screen.findByText('This vehicle is no longer available.');
      await waitFor(() => expect(screen.queryByText('ALPHA123')).not.toBeInTheDocument());
      expect(document.body.textContent).not.toContain('not-owned');
      expect(list).toHaveBeenCalledTimes(2);
    },
  );
  it('preserves the confirmation and safe row after a delete infrastructure failure', async () => {
    vi.spyOn(vehiclesApi, 'listVehicles').mockResolvedValue({ vehicles: [vehicleA] });
    const deletion = vi
      .spyOn(vehiclesApi, 'deleteVehicle')
      .mockRejectedValue(new api.ApiClientError('private', 500));
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not change');
    expect(screen.getByText('ALPHA123')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeEnabled();
    expect(deletion).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['update', 'success'],
    ['update', '401'],
    ['update', '404'],
    ['delete', 'success'],
    ['delete', '401'],
    ['delete', '404'],
  ] as const)(
    'discards delayed user-A %s %s after a cross-tab account switch',
    async (operation, outcome) => {
      const stale = deferred<{ vehicle: typeof vehicleA }>();
      const synchronize = deferred<RefreshResponse>();
      const list = vi
        .spyOn(vehiclesApi, 'listVehicles')
        .mockResolvedValue({ vehicles: [vehicleA] });
      const update = vi.spyOn(vehiclesApi, 'updateVehicle').mockReturnValue(stale.promise);
      const deletion = vi.spyOn(vehiclesApi, 'deleteVehicle').mockImplementation(async () => {
        await stale.promise;
      });
      const view = setup();
      await screen.findByText('ALPHA123');
      if (operation === 'update') {
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        const form = within(screen.getByRole('form', { name: 'Edit vehicle' }));
        fireEvent.change(form.getByLabelText('Model'), { target: { value: 'Hybrid' } });
        fireEvent.click(form.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
        await waitFor(() => expect(deletion).toHaveBeenCalledTimes(1));
      }
      view.refresh.mockReturnValueOnce(synchronize.promise);
      view.emit('session-changed');
      expect(screen.getByText('Updating your session…')).toBeVisible();
      expect(screen.queryByText('ALPHA123')).not.toBeInTheDocument();
      expect(screen.queryByRole('form', { name: 'Edit vehicle' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument();
      expect(view.client.getQueryData(vehicleQueryKey(userA.id))).toBeUndefined();
      expect(
        operation === 'update'
          ? update.mock.calls[0]?.[3]?.aborted
          : deletion.mock.calls[0]?.[2]?.aborted,
      ).toBe(true);
      list.mockResolvedValue({ vehicles: [vehicleB] });
      await act(async () => synchronize.resolve(refreshed('test-only-beta-token')));
      await screen.findByText('BETA123');
      await act(async () => {
        if (outcome === 'success') stale.resolve({ vehicle: { ...vehicleA, model: 'Hybrid' } });
        else
          stale.reject(
            new api.ApiClientError(
              'stale-detail',
              Number(outcome),
              outcome === '401' ? 'AUTHENTICATION_REQUIRED' : 'VEHICLE_NOT_FOUND',
            ),
          );
      });
      expect(screen.getByText(userB.email)).toBeVisible();
      expect(screen.getByText('BETA123')).toBeVisible();
      expect(
        screen.queryByText(
          /Vehicle updated\.|Vehicle deleted\.|no longer available|ALPHA123|stale-detail/,
        ),
      ).not.toBeInTheDocument();
      expect(view.client.getQueryData(vehicleQueryKey(userA.id))).toBeUndefined();
      expect(view.client.getQueryData(vehicleQueryKey(userB.id))).toEqual({ vehicles: [vehicleB] });
      expect(list).toHaveBeenCalledTimes(2);
    },
  );
  it.each(['update', 'delete'] as const)(
    'removes %s state on remote logout and ignores late completion',
    async (operation) => {
      vi.spyOn(vehiclesApi, 'listVehicles').mockResolvedValue({ vehicles: [vehicleA] });
      const stale = deferred<{ vehicle: typeof vehicleA }>();
      vi.spyOn(vehiclesApi, 'updateVehicle').mockReturnValue(stale.promise);
      vi.spyOn(vehiclesApi, 'deleteVehicle').mockImplementation(async () => {
        await stale.promise;
      });
      const view = setup();
      await screen.findByText('ALPHA123');
      fireEvent.click(
        screen.getByRole('button', {
          name: operation === 'update' ? 'Edit' : 'Delete',
        }),
      );
      if (operation === 'update') {
        const form = within(screen.getByRole('form', { name: 'Edit vehicle' }));
        fireEvent.change(form.getByLabelText('Model'), { target: { value: 'Hybrid' } });
        fireEvent.click(form.getByRole('button', { name: 'Save' }));
      } else fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', {
            name: operation === 'update' ? 'Saving changes…' : 'Deleting…',
          }),
        ).toBeDisabled(),
      );
      view.emit('logout');
      expect(screen.queryByText('ALPHA123')).not.toBeInTheDocument();
      expect(screen.queryByRole('form', { name: 'Edit vehicle' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument();
      await act(async () => stale.resolve({ vehicle: vehicleA }));
      expect(screen.getByText('Sign in to add and view your vehicles.')).toBeVisible();
      expect(view.client.getQueryData(vehicleQueryKey(userA.id))).toBeUndefined();
    },
  );
  it.each(['update', 'delete'] as const)(
    'clears protected state on current-user %s 401 without retry',
    async (operation) => {
      vi.spyOn(vehiclesApi, 'listVehicles').mockResolvedValue({ vehicles: [vehicleA] });
      const failure = new api.ApiClientError('Required', 401, 'AUTHENTICATION_REQUIRED');
      const update = vi.spyOn(vehiclesApi, 'updateVehicle').mockRejectedValue(failure);
      const deletion = vi.spyOn(vehiclesApi, 'deleteVehicle').mockRejectedValue(failure);
      const view = setup();
      await screen.findByText('ALPHA123');
      if (operation === 'update') {
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        const form = within(screen.getByRole('form', { name: 'Edit vehicle' }));
        fireEvent.change(form.getByLabelText('Model'), { target: { value: 'Hybrid' } });
        fireEvent.click(form.getByRole('button', { name: 'Save' }));
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
      }
      await screen.findByText('Sign in to add and view your vehicles.');
      expect(view.client.getQueryData(vehicleQueryKey(userA.id))).toBeUndefined();
      expect(operation === 'update' ? update : deletion).toHaveBeenCalledTimes(1);
      expect(view.refresh).toHaveBeenCalledTimes(1);
    },
  );
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
