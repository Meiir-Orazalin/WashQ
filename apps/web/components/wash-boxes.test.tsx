import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/lib/api-client';
import * as boxesApi from '@/lib/wash-box-api-client';
import * as branchesApi from '@/lib/branch-api-client';
import * as organizationsApi from '@/lib/organization-api-client';
import type { AuthLifecycleChannel, AuthLifecycleEvent } from '@/lib/auth-lifecycle-channel';
import { AuthenticationProvider } from '@/providers/authentication-provider';
import { WashBoxes } from './wash-boxes';
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
  number: 1,
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
  const list = vi.spyOn(boxesApi, 'listWashBoxes').mockResolvedValue({ washBoxes: [box] });
  const get = vi.spyOn(boxesApi, 'getWashBox').mockResolvedValue({ washBox: box });
  const refreshCoordinator = { refresh, waitForIdle: vi.fn().mockResolvedValue(undefined) };
  const lifecycleChannelFactory = () => channel;
  const tree = (branchId: string) => (
    <QueryClientProvider client={client}>
      <AuthenticationProvider
        refreshCoordinator={refreshCoordinator}
        lifecycleChannelFactory={lifecycleChannelFactory}
      >
        <WashBoxes
          organizationId={org}
          branchId={branchId}
          {...(detail ? { washBoxId: box.id } : {})}
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
describe('wash box protected UI, confirmations and scoped cache', () => {
  it('shows context, active/inactive configuration and detail navigation', async () => {
    const view = setup();
    view.list.mockResolvedValue({
      washBoxes: [box, { ...box, id: otherBranch, number: 2, isActive: false }],
    });
    await screen.findByText('Active');
    await screen.findByText('Inactive');
    expect(screen.getByRole('link', { name: 'View Box 1' })).toBeVisible();
    expect(screen.getByText(/not a real-time free or busy/)).toBeVisible();
  });
  it('validates whole numbers, handles empty list, creates once, resets and refetches', async () => {
    const pending = deferred<{ washBox: typeof box }>();
    const create = vi.spyOn(boxesApi, 'createWashBox').mockReturnValue(pending.promise);
    const view = setup();
    view.list.mockResolvedValue({ washBoxes: [] });
    await screen.findByText('No wash boxes saved for this branch yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Create box' }));
    expect(screen.getByLabelText('Box number')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Box number')).toHaveAccessibleDescription();
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Box number'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create box' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Create wash box' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Creating box…' })).toBeDisabled();
    view.list.mockResolvedValue({ washBoxes: [box] });
    await act(async () => pending.resolve({ washBox: box }));
    await screen.findByText('Wash box created.');
    expect(screen.getByLabelText('Box number')).toHaveValue(null);
    const serialized = JSON.stringify([
      document.body.innerHTML,
      view.client
        .getQueryCache()
        .getAll()
        .map((q) => [q.queryKey, q.state.data]),
      view.client
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    ]);
    expect(serialized.includes('test-only-alpha-token')).toBe(false);
  });
  it('requires keyboard-focusable deactivation confirmation and cancellation sends no request', async () => {
    const write = vi.spyOn(boxesApi, 'setWashBoxActiveState');
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Disable Box 1' }));
    expect(screen.getByRole('button', { name: 'Confirm deactivation' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Disable Box 1' })).toHaveFocus();
    expect(write).not.toHaveBeenCalled();
  });
  it('deactivates only after server confirmation and reactivates explicitly', async () => {
    const pending = deferred<{ washBox: typeof box }>();
    const write = vi
      .spyOn(boxesApi, 'setWashBoxActiveState')
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ washBox: box });
    const view = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Disable Box 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Active')).toBeVisible();
    expect(screen.queryByText('Inactive')).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm deactivation' })).toBeDisabled();
    view.list.mockResolvedValue({ washBoxes: [{ ...box, isActive: false }] });
    await act(async () => pending.resolve({ washBox: { ...box, isActive: false } }));
    await screen.findByText('Inactive');
    await screen.findByText('Box activity saved.');
    view.list.mockResolvedValue({ washBoxes: [box] });
    fireEvent.click(screen.getByRole('button', { name: 'Enable Box 1' }));
    await screen.findByText('Active');
    expect(write.mock.calls.map((call) => call[4])).toEqual([
      { isActive: false },
      { isActive: true },
    ]);
  });
  it.each([
    'WASH_BOX_ALREADY_EXISTS',
    'WASH_BOX_NOT_FOUND',
    'BRANCH_NOT_FOUND',
    'ORGANIZATION_NOT_FOUND',
    'INTERNAL_SERVER_ERROR',
  ])('sanitizes %s without false success', async (code) => {
    vi.spyOn(boxesApi, 'createWashBox').mockRejectedValue(
      new api.ApiClientError('private detail', code.includes('EXISTS') ? 409 : 500, code),
    );
    setup();
    fireEvent.change(await screen.findByLabelText('Box number'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create box' }));
    await screen.findByRole('alert');
    expect(document.body.textContent).not.toContain('private detail');
    expect(screen.queryByText('Wash box created.')).toBeNull();
  });
  it('detail includes inactive box and no creation form', async () => {
    const view = setup('authenticated', true);
    view.get.mockResolvedValue({ washBox: { ...box, isActive: false } });
    await screen.findByText('Inactive');
    expect(screen.queryByLabelText('Box number')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to wash boxes' })).toBeVisible();
  });
  it.each(['pending', 'unauthenticated'] as const)('%s hides protected UI', async (state) => {
    setup(state);
    await waitFor(() => expect(screen.queryByLabelText('Box number')).toBeNull());
    expect(screen.queryByText('First Branch')).toBeNull();
  });
  it('remote logout removes confirmation, list and both cache families', async () => {
    const view = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Disable Box 1' }));
    view.client.setQueryData(['wash-box', userA.id, org, branch, box.id], { washBox: box });
    view.emit('logout');
    await screen.findByText('Sign in to create and view your organizations.');
    expect(screen.queryByText('Box 1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm deactivation' })).toBeNull();
    expect(
      view.client
        .getQueryCache()
        .getAll()
        .filter((q) => String(q.queryKey[0]).startsWith('wash-box')),
    ).toHaveLength(0);
  });
  for (const result of ['success', '401', '404', '500'] as const)
    it(`account switch ignores stale mutation ${result} and clears protected data immediately`, async () => {
      const pending = deferred<{ washBox: typeof box }>();
      const write = vi.spyOn(boxesApi, 'setWashBoxActiveState').mockReturnValue(pending.promise);
      const view = setup();
      fireEvent.click(await screen.findByRole('button', { name: 'Disable Box 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
      await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      const sync = deferred<{ accessToken: string; accessTokenExpiresAt: string }>();
      view.refresh.mockReturnValueOnce(sync.promise);
      view.emit('session-changed');
      expect(screen.queryByText('Box 1')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Confirm deactivation' })).toBeNull();
      view.list.mockResolvedValue({ washBoxes: [{ ...box, number: 9 }] });
      await act(async () =>
        sync.resolve({
          accessToken: 'test-only-beta-token',
          accessTokenExpiresAt: new Date(Date.now() + 900000).toISOString(),
        }),
      );
      await screen.findByText('Box 9');
      await act(async () =>
        result === 'success'
          ? pending.resolve({ washBox: box })
          : pending.reject(
              new api.ApiClientError(
                'private',
                Number(result),
                result === '401' ? 'AUTHENTICATION_REQUIRED' : 'WASH_BOX_NOT_FOUND',
              ),
            ),
      );
      expect(screen.getByText('Box 9')).toBeVisible();
      expect(screen.queryByText('Box activity saved.')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(
        view.client
          .getQueryCache()
          .getAll()
          .filter(
            (q) => String(q.queryKey[0]).startsWith('wash-box') && q.queryKey[1] === userA.id,
          ),
      ).toHaveLength(0);
    });
  it('same-account branch navigation aborts old writes, resets confirmation and ignores delayed success', async () => {
    const pending = deferred<{ washBox: typeof box }>();
    const write = vi.spyOn(boxesApi, 'setWashBoxActiveState').mockReturnValue(pending.promise);
    const view = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Disable Box 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    view.list.mockResolvedValue({ washBoxes: [{ ...box, number: 8 }] });
    view.navigate();
    await screen.findByText('Box 8');
    expect(write.mock.calls[0]?.[5]?.aborted).toBe(true);
    await act(async () => pending.resolve({ washBox: box }));
    expect(screen.getByText('Box 8')).toBeVisible();
    expect(screen.queryByText('Box activity saved.')).toBeNull();
    expect(screen.queryByText('Box 1')).toBeNull();
  });
});
