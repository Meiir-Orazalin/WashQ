import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/lib/api-client';
import * as servicesApi from '@/lib/branch-service-api-client';
import * as branchesApi from '@/lib/branch-api-client';
import * as organizationsApi from '@/lib/organization-api-client';
import type { AuthLifecycleChannel, AuthLifecycleEvent } from '@/lib/auth-lifecycle-channel';
import { AuthenticationProvider } from '@/providers/authentication-provider';
import { BranchServices } from './branch-services';
const userA = {
  id: '00000000-0000-4000-8000-000000000001',
  firstName: 'Alpha',
  lastName: null,
  email: 'a@example.invalid',
};
const userB = { ...userA, id: '00000000-0000-4000-8000-000000000002', firstName: 'Beta' };
const org = '00000000-0000-4000-8000-000000000003';
const branch = '00000000-0000-4000-8000-000000000004';
const otherBranch = '00000000-0000-4000-8000-000000000005';
const box = {
  id: '00000000-0000-4000-8000-000000000006',
  name: 'Exterior wash',
  description: 'Plain',
  durationMinutes: 30,
  priceMinor: 500050,
  currency: 'KZT' as const,
  isActive: true,
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(
  initial: 'authenticated' | 'pending' | 'unauthenticated' = 'authenticated',
  detail = false,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let listener: ((event: AuthLifecycleEvent) => void) | undefined;
  const channel: AuthLifecycleChannel = {
    publishSessionChanged: vi.fn(),
    publishProfileChanged: vi.fn(),
    publishLogout: vi.fn(),
    close: vi.fn(),
    subscribe(callback) {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  const refresh = vi.fn().mockResolvedValue({
    accessToken: 'test-only-alpha-token',
    accessTokenExpiresAt: new Date(Date.now() + 900000).toISOString(),
  });
  if (initial === 'pending') refresh.mockImplementation(() => new Promise(() => undefined));
  if (initial === 'unauthenticated')
    refresh.mockRejectedValue(
      new api.ApiClientError('Invalid session', 401, 'INVALID_REFRESH_SESSION'),
    );
  vi.spyOn(api, 'getCurrentUser').mockImplementation(async (token) => ({
    user: token === 'test-only-beta-token' ? userB : userA,
  }));
  vi.spyOn(organizationsApi, 'getOwnedOrganization').mockResolvedValue({
    organization: {
      id: org,
      name: 'Owned Wash',
      description: null,
      createdAt: box.createdAt,
      updatedAt: box.updatedAt,
    },
  });
  vi.spyOn(branchesApi, 'getOwnedBranch').mockImplementation(async (_token, _org, id) => ({
    branch: {
      id,
      name: id === branch ? 'First Branch' : 'Second Branch',
      city: 'Astana',
      addressLine: 'Address 12',
      timeZone: 'Asia/Almaty',
      createdAt: box.createdAt,
      updatedAt: box.updatedAt,
      openingHours: [],
    },
  }));
  const list = vi.spyOn(servicesApi, 'listBranchServices').mockResolvedValue({ services: [box] });
  const get = vi.spyOn(servicesApi, 'getBranchService').mockResolvedValue({ service: box });
  const refreshCoordinator = { refresh, waitForIdle: vi.fn().mockResolvedValue(undefined) };
  const lifecycleChannelFactory = () => channel;
  const tree = (branchId: string) => (
    <QueryClientProvider client={client}>
      <AuthenticationProvider
        refreshCoordinator={refreshCoordinator}
        lifecycleChannelFactory={lifecycleChannelFactory}
      >
        <BranchServices
          organizationId={org}
          branchId={branchId}
          {...(detail ? { serviceId: box.id } : {})}
        />
      </AuthenticationProvider>
    </QueryClientProvider>
  );
  const view = render(tree(branch));
  return {
    client,
    refresh,
    list,
    get,
    emit(type: AuthLifecycleEvent['type']) {
      act(() => listener?.({ type, sourceId: 'other-tab' }));
    },
    navigate() {
      view.rerender(tree(otherBranch));
    },
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('branch services UI and identity/resource isolation', () => {
  it('announces pending list and safely renders a failed request', async () => {
    const pending = deferred<{ services: (typeof box)[] }>();
    const view = setup();
    view.list.mockReturnValue(pending.promise);
    await screen.findByText('Loading services…');
    expect(screen.queryByLabelText('Service name')).toBeNull();
    await act(async () => pending.reject(new api.ApiClientError('private detail', 500)));
    await screen.findByRole('alert');
    expect(document.body.textContent).not.toContain('private detail');
  });
  it('ambiguous creation is not retried and tells the owner to check the list', async () => {
    const create = vi
      .spyOn(servicesApi, 'createBranchService')
      .mockRejectedValue(new api.ApiClientError('private transport'));
    setup();
    for (const [label, value] of [
      ['Service name', 'Wash'],
      ['Duration (minutes)', '30'],
      ['Price (KZT)', '0.01'],
    ] as const)
      fireEvent.change(await screen.findByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Create service' }));
    await screen.findByText(
      'The creation result could not be confirmed. Check the list before creating again.',
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Service created.')).toBeNull();
    expect(screen.getByLabelText('Price (KZT)')).toHaveValue('0.01');
  });
  it.each(['success', '401', '404', '500'] as const)(
    'account switch ignores stale list %s',
    async (result) => {
      const pending = deferred<{ services: (typeof box)[] }>();
      const view = setup();
      view.list.mockReturnValueOnce(pending.promise);
      await waitFor(() => expect(view.list).toHaveBeenCalledTimes(1));
      view.list.mockResolvedValue({ services: [{ ...box, name: 'Beta wash' }] });
      view.refresh.mockResolvedValue({
        accessToken: 'test-only-beta-token',
        accessTokenExpiresAt: new Date(Date.now() + 900000).toISOString(),
      });
      view.emit('session-changed');
      await screen.findByText('Beta wash');
      await act(async () =>
        result === 'success'
          ? pending.resolve({ services: [box] })
          : pending.reject(
              new api.ApiClientError(
                'private',
                Number(result),
                result === '401' ? 'AUTHENTICATION_REQUIRED' : 'SERVICE_NOT_FOUND',
              ),
            ),
      );
      expect(screen.getByText('Beta wash')).toBeVisible();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByText('Exterior wash')).toBeNull();
    },
  );
  it('shows active/inactive services, prices, durations and owner context', async () => {
    const view = setup();
    view.list.mockResolvedValue({
      services: [box, { ...box, id: otherBranch, name: 'Other wash', isActive: false }],
    });
    await screen.findByText('Active');
    await screen.findByText('Inactive');
    expect(screen.getByRole('link', { name: 'View Exterior wash' })).toBeVisible();
    expect(screen.getAllByText(/KZT.*5,000.50.*30 minutes/)).toHaveLength(2);
    expect(screen.getByText(/not a guarantee of booking/)).toBeVisible();
  });
  it('validates creation, converts exact KZT, prevents duplicate submits and resets after confirmed success', async () => {
    const pending = deferred<{ service: typeof box }>();
    const create = vi.spyOn(servicesApi, 'createBranchService').mockReturnValue(pending.promise);
    const view = setup();
    view.list.mockResolvedValue({ services: [] });
    await screen.findByText('No services saved for this branch yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Create service' }));
    expect(screen.getByLabelText('Service name')).toHaveAttribute('aria-invalid', 'true');
    expect(create).not.toHaveBeenCalled();
    for (const [label, value] of [
      ['Service name', 'Exterior wash'],
      ['Duration (minutes)', '30'],
      ['Price (KZT)', '5000,50'],
    ])
      fireEvent.change(screen.getByLabelText(label ?? ''), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Create service' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Create service' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[3]).toEqual({
      name: 'Exterior wash',
      description: null,
      durationMinutes: 30,
      priceMinor: 500050,
      currency: 'KZT',
    });
    expect(screen.getByRole('button', { name: 'Saving service…' })).toBeDisabled();
    await act(async () => pending.resolve({ service: box }));
    await screen.findByText('Service created.');
    expect(screen.getByLabelText('Price (KZT)')).toHaveValue('');
    expect(
      JSON.stringify([
        document.body.innerHTML,
        view.client
          .getQueryCache()
          .getAll()
          .map((q) => [q.queryKey, q.state.data]),
        view.client
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
      ]).includes('test-only-alpha-token'),
    ).toBe(false);
  });
  it('edit prefills exact minor units, cancel sends no request, saves only changed fields and announces success', async () => {
    const write = vi.spyOn(servicesApi, 'updateBranchService').mockResolvedValue({ service: box });
    const view = setup('authenticated', true);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit service' }));
    expect(screen.getByLabelText('Service name')).toHaveFocus();
    expect(screen.getByLabelText('Price (KZT)')).toHaveValue('5000.50');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit service' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Edit service' }));
    fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: '' } });
    view.get.mockResolvedValue({ service: { ...box, description: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    await screen.findByText('Service saved.');
    expect(write.mock.calls[0]?.[4]).toEqual({ description: null });
    expect(screen.queryByRole('form', { name: 'Edit service' })).toBeNull();
  });
  it('deactivation is confirmed, cancellation sends no request, state is not optimistic and reactivation is explicit', async () => {
    const pending = deferred<{ service: typeof box }>();
    const write = vi
      .spyOn(servicesApi, 'updateBranchService')
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ service: box });
    const view = setup('authenticated', true);
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate service' }));
    expect(screen.getByRole('button', { name: 'Confirm deactivation' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate service' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Active')).toBeVisible();
    view.get.mockResolvedValue({ service: { ...box, isActive: false } });
    await act(async () => pending.resolve({ service: { ...box, isActive: false } }));
    await screen.findByText('Inactive');
    view.get.mockResolvedValue({ service: box });
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate service' }));
    await screen.findByText('Active');
    expect(write.mock.calls.map((call) => call[4])).toEqual([
      { isActive: false },
      { isActive: true },
    ]);
  });
  it.each([
    'SERVICE_NOT_FOUND',
    'BRANCH_NOT_FOUND',
    'ORGANIZATION_NOT_FOUND',
    'INTERNAL_SERVER_ERROR',
  ])('sanitizes %s without false success', async (code) => {
    vi.spyOn(servicesApi, 'updateBranchService').mockRejectedValue(
      new api.ApiClientError('private detail', 500, code),
    );
    setup('authenticated', true);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit service' }));
    fireEvent.change(screen.getByLabelText('Price (KZT)'), { target: { value: '1.01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    await screen.findByRole('alert');
    expect(document.body.textContent).not.toContain('private detail');
    expect(screen.queryByText('Service saved.')).toBeNull();
  });
  it.each(['pending', 'unauthenticated'] as const)(
    '%s hides protected forms and context',
    async (state) => {
      setup(state);
      await waitFor(() => expect(screen.queryByLabelText('Service name')).toBeNull());
      expect(screen.queryByText('Exterior wash')).toBeNull();
    },
  );
  it('loading, generic list failure and logout clear protected forms/caches', async () => {
    const view = setup('authenticated', true);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit service' }));
    view.emit('logout');
    await screen.findByText('Sign in to create and view your organizations.');
    expect(screen.queryByLabelText('Service name')).toBeNull();
    expect(
      view.client
        .getQueryCache()
        .getAll()
        .filter((q) => String(q.queryKey[0]).startsWith('branch-service')),
    ).toHaveLength(0);
  });
  it.each(['success', '401', '404', '500'] as const)(
    'account switch ignores stale patch %s',
    async (result) => {
      const pending = deferred<{ service: typeof box }>();
      const write = vi.spyOn(servicesApi, 'updateBranchService').mockReturnValue(pending.promise);
      const view = setup('authenticated', true);
      fireEvent.click(await screen.findByRole('button', { name: 'Edit service' }));
      fireEvent.change(screen.getByLabelText('Service name'), {
        target: { value: 'Alpha update' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
      await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      const sync = deferred<{ accessToken: string; accessTokenExpiresAt: string }>();
      view.refresh.mockReturnValueOnce(sync.promise);
      view.emit('session-changed');
      expect(screen.queryByLabelText('Service name')).toBeNull();
      expect(screen.queryByText('Exterior wash')).toBeNull();
      view.get.mockResolvedValue({ service: { ...box, name: 'Beta wash' } });
      await act(async () =>
        sync.resolve({
          accessToken: 'test-only-beta-token',
          accessTokenExpiresAt: new Date(Date.now() + 900000).toISOString(),
        }),
      );
      await screen.findByText('Beta wash');
      await act(async () =>
        result === 'success'
          ? pending.resolve({ service: box })
          : pending.reject(
              new api.ApiClientError(
                'private',
                Number(result),
                result === '401' ? 'AUTHENTICATION_REQUIRED' : 'SERVICE_NOT_FOUND',
              ),
            ),
      );
      expect(screen.getByText('Beta wash')).toBeVisible();
      expect(screen.queryByText('Service saved.')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(
        view.client
          .getQueryCache()
          .getAll()
          .filter(
            (q) => String(q.queryKey[0]).startsWith('branch-service') && q.queryKey[1] === userA.id,
          ),
      ).toHaveLength(0);
    },
  );
  it.each(['success', '401', '404', '500'] as const)(
    'branch navigation ignores stale patch %s',
    async (result) => {
      const pending = deferred<{ service: typeof box }>();
      const write = vi.spyOn(servicesApi, 'updateBranchService').mockReturnValue(pending.promise);
      const view = setup('authenticated', true);
      fireEvent.click(await screen.findByRole('button', { name: 'Deactivate service' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
      await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      view.get.mockResolvedValue({ service: { ...box, name: 'Second branch wash' } });
      view.navigate();
      await screen.findByText('Second branch wash');
      expect(write.mock.calls[0]?.[5]?.aborted).toBe(true);
      await act(async () =>
        result === 'success'
          ? pending.resolve({ service: box })
          : pending.reject(new api.ApiClientError('private', Number(result), 'SERVICE_NOT_FOUND')),
      );
      expect(screen.getByText('Second branch wash')).toBeVisible();
      expect(screen.queryByText('Service activity saved.')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );
});
