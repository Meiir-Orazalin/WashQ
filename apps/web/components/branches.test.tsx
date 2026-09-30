import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  weekdays,
  type BranchDetailResponse,
  type OpeningHoursResponse,
} from '@washqueue/contracts';
import * as api from '@/lib/api-client';
import * as branchesApi from '@/lib/branch-api-client';
import * as organizationsApi from '@/lib/organization-api-client';
import type { AuthLifecycleChannel, AuthLifecycleEvent } from '@/lib/auth-lifecycle-channel';
import { AuthenticationProvider } from '@/providers/authentication-provider';
import { Branches } from './branches';
import { BranchDetail } from './branch-detail';
const userA = {
  id: '00000000-0000-4000-8000-000000000001',
  firstName: 'Alpha',
  lastName: null,
  email: 'a@example.invalid',
};
const userB = {
  ...userA,
  id: '00000000-0000-4000-8000-000000000002',
  firstName: 'Beta',
  email: 'b@example.invalid',
};
const orgId = '00000000-0000-4000-8000-000000000003';
const branchId = '00000000-0000-4000-8000-000000000004';
const branch = {
  id: branchId,
  name: 'Alpha Branch',
  city: 'Astana',
  addressLine: 'Ordinary <b>address</b>',
  timeZone: 'Asia/Almaty',
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
};
const week = weekdays.map((dayOfWeek) => ({
  dayOfWeek,
  status: 'CLOSED' as const,
  opensAt: null,
  closesAt: null,
  closesNextDay: false,
}));
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
  children: ReactNode = <Branches organizationId={orgId} />,
  initial: 'pending' | 'unauthenticated' | 'authenticated' = 'authenticated',
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
      id: orgId,
      name: 'Owned Wash',
      description: null,
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt,
    },
  });
  render(
    <QueryClientProvider client={client}>
      <AuthenticationProvider
        refreshCoordinator={{ refresh, waitForIdle: vi.fn().mockResolvedValue(undefined) }}
        lifecycleChannelFactory={() => channel}
      >
        {children}
      </AuthenticationProvider>
    </QueryClientProvider>,
  );
  return {
    client,
    refresh,
    emit(type: AuthLifecycleEvent['type']) {
      act(() => listener?.({ type, sourceId: 'other-tab' }));
    },
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('protected branch UI and identity cache', () => {
  it('shows accessible validation and empty state, rejects invalid time zone without request', async () => {
    vi.spyOn(branchesApi, 'listOwnedBranches').mockResolvedValue({ branches: [] });
    const create = vi.spyOn(branchesApi, 'createBranch');
    setup();
    await screen.findByText('No branches yet. Create your first branch.');
    fireEvent.click(screen.getByRole('button', { name: 'Create branch' }));
    expect(screen.getByLabelText('Branch name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Branch name')).toHaveAccessibleDescription();
    for (const [label, value] of [
      ['Branch name', 'Branch'],
      ['City', 'Astana'],
      ['Address', 'Address 12'],
      ['IANA time zone', '+05:00'],
    ] as const)
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Create branch' }));
    expect(screen.getByLabelText('IANA time zone')).toHaveAttribute('aria-invalid', 'true');
    expect(create).not.toHaveBeenCalled();
  });
  it('creates normalized data once, resets form and refetches only own list', async () => {
    const list = vi.spyOn(branchesApi, 'listOwnedBranches').mockResolvedValue({ branches: [] });
    const pending = deferred<{ branch: typeof branch }>();
    const create = vi.spyOn(branchesApi, 'createBranch').mockReturnValue(pending.promise);
    const view = setup();
    for (const [label, value] of [
      ['Branch name', ' Ｂranch '],
      ['City', ' Astana '],
      ['Address', ' Address 12 '],
      ['IANA time zone', 'Asia/Almaty'],
    ] as const)
      fireEvent.change(await screen.findByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Create branch' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Create branch' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.slice(1, 3)).toEqual([
      orgId,
      { name: 'Branch', city: 'Astana', addressLine: 'Address 12', timeZone: 'Asia/Almaty' },
    ]);
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    list.mockResolvedValue({ branches: [branch] });
    await act(async () => pending.resolve({ branch }));
    await screen.findByText('Branch created.');
    expect(screen.getByLabelText('Branch name')).toHaveValue('');
    expect(screen.getByRole('link', { name: 'Alpha Branch' })).toBeVisible();
    expect(
      JSON.stringify([
        view.client
          .getQueryCache()
          .getAll()
          .map((q) => [q.queryKey, q.state.data]),
        view.client
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
        document.body.innerHTML,
      ]).includes('test-only-alpha-token'),
    ).toBe(false);
  });
  for (const state of ['pending', 'unauthenticated'] as const)
    it(`${state} hides data and forms`, async () => {
      const list = vi.spyOn(branchesApi, 'listOwnedBranches');
      setup(undefined, state);
      await screen.findByText(
        state === 'pending'
          ? 'Restoring your session…'
          : 'Sign in to create and view your organizations.',
      );
      expect(screen.queryByLabelText('Branch name')).not.toBeInTheDocument();
      expect(list).not.toHaveBeenCalled();
    });
  it('renders seven unsaved closed defaults, validates intervals, saves overnight and announces success', async () => {
    const get = vi
      .spyOn(branchesApi, 'getOwnedBranch')
      .mockResolvedValue({ branch: { ...branch, openingHours: [] } });
    const pending = deferred<OpeningHoursResponse>();
    const replace = vi.spyOn(branchesApi, 'replaceOpeningHours').mockReturnValue(pending.promise);
    setup(<BranchDetail organizationId={orgId} branchId={branchId} />);
    await screen.findByText('Opening hours have not been configured.');
    expect(screen.getAllByRole('group')).toHaveLength(7);
    expect(screen.getByLabelText('MONDAY opening time')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('MONDAY status'), { target: { value: 'OPEN' } });
    fireEvent.change(screen.getByLabelText('MONDAY opening time'), { target: { value: '22:00' } });
    fireEvent.change(screen.getByLabelText('MONDAY closing time'), { target: { value: '02:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save opening hours' }));
    expect(screen.getByLabelText('MONDAY closing time')).toHaveAttribute('aria-invalid', 'true');
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('MONDAY closes next day'));
    fireEvent.click(screen.getByRole('button', { name: 'Save opening hours' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Weekly opening hours' }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const submitted = replace.mock.calls[0]?.[3];
    if (!submitted) throw new Error('Schedule request did not occur');
    expect(submitted.openingHours).toHaveLength(7);
    expect(submitted.openingHours[0]).toEqual({
      ...week[0],
      status: 'OPEN',
      opensAt: '22:00',
      closesAt: '02:00',
      closesNextDay: true,
    });
    get.mockResolvedValue({ branch: { ...branch, openingHours: submitted.openingHours } });
    await act(async () => pending.resolve(submitted));
    await screen.findByText('Opening hours saved.');
    expect(screen.getByText('MONDAY: 22:00–02:00 (next day)')).toBeVisible();
    expect(screen.queryByText('Opening hours have not been configured.')).not.toBeInTheDocument();
  });
  it('prefills saved schedule, nulls irrelevant controls and renders address only as text', async () => {
    vi.spyOn(branchesApi, 'getOwnedBranch').mockResolvedValue({
      branch: {
        ...branch,
        openingHours: week.map((entry) => ({
          ...entry,
          status: 'OPEN',
          opensAt: '09:00',
          closesAt: '20:00',
        })),
      },
    });
    setup(<BranchDetail organizationId={orgId} branchId={branchId} />);
    expect(await screen.findByLabelText('MONDAY opening time')).toHaveValue('09:00');
    fireEvent.change(screen.getByLabelText('MONDAY status'), {
      target: { value: 'OPEN_24_HOURS' },
    });
    expect(screen.getByLabelText('MONDAY opening time')).toHaveValue('');
    expect(screen.getByLabelText('MONDAY opening time')).toBeDisabled();
    expect(document.querySelector('dd b')).toBeNull();
  });
  for (const code of ['ORGANIZATION_NOT_FOUND', 'BRANCH_NOT_FOUND', undefined])
    it(`safe detail error ${code}`, async () => {
      vi.spyOn(branchesApi, 'getOwnedBranch').mockRejectedValue(
        new api.ApiClientError('private details', code ? 404 : 500, code),
      );
      setup(<BranchDetail organizationId={orgId} branchId={branchId} />);
      await screen.findByRole('alert');
      expect(document.body.textContent).not.toContain('private details');
      expect(screen.queryByRole('form')).not.toBeInTheDocument();
    });
  for (const outcome of ['success', '401', '404', '500'])
    it(`account switch ignores old schedule ${outcome} and removes caches/forms`, async () => {
      vi.spyOn(branchesApi, 'getOwnedBranch').mockImplementation(async (token) => ({
        branch: {
          ...branch,
          name: token === 'test-only-beta-token' ? 'Beta Branch' : 'Alpha Branch',
          openingHours: week,
        },
      }));
      const pending = deferred<OpeningHoursResponse>();
      vi.spyOn(branchesApi, 'replaceOpeningHours').mockReturnValue(pending.promise);
      const view = setup(<BranchDetail organizationId={orgId} branchId={branchId} />);
      await screen.findByRole('heading', { name: 'Alpha Branch' });
      fireEvent.click(screen.getByRole('button', { name: 'Save opening hours' }));
      await screen.findByText('Saving opening hours…');
      const synchronization = deferred<{ accessToken: string; accessTokenExpiresAt: string }>();
      view.refresh.mockReturnValue(synchronization.promise);
      view.emit('session-changed');
      expect(screen.queryByText('Alpha Branch')).not.toBeInTheDocument();
      expect(screen.queryByRole('form', { name: 'Weekly opening hours' })).not.toBeInTheDocument();
      await act(async () =>
        synchronization.resolve({
          accessToken: 'test-only-beta-token',
          accessTokenExpiresAt: new Date(Date.now() + 900000).toISOString(),
        }),
      );
      await screen.findByRole('heading', { name: 'Beta Branch' });
      await act(async () => {
        if (outcome === 'success') pending.resolve({ openingHours: week });
        else
          pending.reject(
            new api.ApiClientError(
              'private stale error',
              Number(outcome),
              outcome === '401'
                ? 'AUTHENTICATION_REQUIRED'
                : outcome === '404'
                  ? 'BRANCH_NOT_FOUND'
                  : undefined,
            ),
          );
      });
      expect(screen.getByRole('heading', { name: 'Beta Branch' })).toBeVisible();
      expect(screen.queryByText('Opening hours saved.')).not.toBeInTheDocument();
      expect(
        view.client
          .getQueryCache()
          .getAll()
          .some((q) => q.queryKey[1] === userA.id),
      ).toBe(false);
    });
  it('remote logout hides list/form and removes both cache families', async () => {
    vi.spyOn(branchesApi, 'getOwnedBranch').mockResolvedValue({
      branch: { ...branch, openingHours: week },
    });
    const view = setup(<BranchDetail organizationId={orgId} branchId={branchId} />);
    await screen.findByRole('heading', { name: 'Alpha Branch' });
    view.client.setQueryData(['branches', userA.id, orgId], { branches: [branch] });
    view.emit('logout');
    expect(screen.queryByRole('form', { name: 'Weekly opening hours' })).not.toBeInTheDocument();
    expect(
      view.client
        .getQueryCache()
        .getAll()
        .some((q) => ['branch', 'branches'].includes(String(q.queryKey[0]))),
    ).toBe(false);
  });
  it('late detail cannot populate a new identity', async () => {
    const old = deferred<BranchDetailResponse>();
    vi.spyOn(branchesApi, 'getOwnedBranch').mockImplementation((token) =>
      token === 'test-only-beta-token'
        ? Promise.resolve({ branch: { ...branch, name: 'Beta Branch', openingHours: [] } })
        : old.promise,
    );
    const view = setup(<BranchDetail organizationId={orgId} branchId={branchId} />);
    await screen.findByText('Loading branch…');
    view.refresh.mockResolvedValue({
      accessToken: 'test-only-beta-token',
      accessTokenExpiresAt: new Date(Date.now() + 900000).toISOString(),
    });
    view.emit('session-changed');
    await screen.findByRole('heading', { name: 'Beta Branch' });
    await act(async () => old.resolve({ branch: { ...branch, openingHours: week } }));
    expect(screen.queryByText('Alpha Branch')).not.toBeInTheDocument();
    expect(
      view.client
        .getQueryCache()
        .getAll()
        .some((q) => q.queryKey[1] === userA.id),
    ).toBe(false);
  });
});
