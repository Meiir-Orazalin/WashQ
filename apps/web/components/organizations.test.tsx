import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import type {
  OrganizationListResponse,
  OrganizationDetailResponse,
  RefreshResponse,
} from '@washqueue/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/lib/api-client';
import * as organizationsApi from '@/lib/organization-api-client';
import type { AuthLifecycleChannel, AuthLifecycleEvent } from '@/lib/auth-lifecycle-channel';
import { AuthenticationProvider, useAuthentication } from '@/providers/authentication-provider';
import { organizationDetailKey, organizationListKey } from '@/hooks/use-organizations';
import { Organizations } from './organizations';
import { OrganizationDetail } from './organization-detail';

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
const organizationA = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Alpha Wash',
  description: 'Ordinary <b>text</b>',
  createdAt: '2026-09-11T00:00:00Z',
  updatedAt: '2026-09-11T00:00:00Z',
};
const organizationB = {
  ...organizationA,
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Beta Wash',
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
function setup(
  children: ReactNode = <Organizations />,
  refresh = vi.fn().mockResolvedValue(refreshed()),
) {
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
    subscribe(callback) {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
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
        refreshCoordinator={{ refresh, waitForIdle: vi.fn().mockResolvedValue(undefined) }}
        lifecycleChannelFactory={() => channel}
      >
        <Probe />
        {children}
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

describe('organization protected UI and identity cache boundary', () => {
  it('renders empty state and accessible validation without a request', async () => {
    vi.spyOn(organizationsApi, 'listOwnedOrganizations').mockResolvedValue({ organizations: [] });
    const create = vi.spyOn(organizationsApi, 'createOrganization');
    setup();
    await screen.findByText('No organizations yet. Create your first organization.');
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(screen.getByLabelText('Organization name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Organization name')).toHaveAccessibleDescription();
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Wash' } });
    fireEvent.change(screen.getByLabelText('Description (optional)'), {
      target: { value: 'x'.repeat(501) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(screen.getByLabelText('Description (optional)')).toHaveAttribute('aria-invalid', 'true');
    expect(create).not.toHaveBeenCalled();
  });
  it('normalizes creation, prevents double submission, resets, refetches and keeps credentials out of caches/markup', async () => {
    const list = vi
      .spyOn(organizationsApi, 'listOwnedOrganizations')
      .mockResolvedValue({ organizations: [] });
    const pending = deferred<OrganizationDetailResponse>();
    const create = vi
      .spyOn(organizationsApi, 'createOrganization')
      .mockReturnValue(pending.promise);
    const view = setup();
    fireEvent.change(await screen.findByLabelText('Organization name'), {
      target: { value: ' Ａlpha  Wash ' },
    });
    fireEvent.change(screen.getByLabelText('Description (optional)'), {
      target: { value: ' Ordinary <b>text</b> ' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Create organization' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Create organization' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[1]).toEqual({
      name: 'Alpha Wash',
      description: 'Ordinary <b>text</b>',
    });
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    list.mockResolvedValue({ organizations: [organizationA] });
    await act(async () => pending.resolve({ organization: organizationA }));
    await screen.findByText('Organization created.');
    expect(screen.getByLabelText('Organization name')).toHaveValue('');
    expect(screen.getByLabelText('Description (optional)')).toHaveValue('');
    expect(screen.getByRole('link', { name: 'Alpha Wash' })).toHaveAttribute(
      'href',
      `/business/organizations/${organizationA.id}`,
    );
    expect(document.querySelector('.organization-description b')).toBeNull();
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
    expect(/test-only-alpha-token|test-only-beta-token/.test(cache)).toBe(false);
    expect(
      view.client
        .getQueryCache()
        .getAll()
        .map(({ queryKey }) => queryKey),
    ).toEqual([organizationListKey(userA.id)]);
  });
  it('shows a safe creation failure without retry and retains form input', async () => {
    vi.spyOn(organizationsApi, 'listOwnedOrganizations').mockResolvedValue({ organizations: [] });
    const create = vi
      .spyOn(organizationsApi, 'createOrganization')
      .mockRejectedValue(new api.ApiClientError('private failure', 500));
    setup();
    fireEvent.change(await screen.findByLabelText('Organization name'), {
      target: { value: 'Wash' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not create your organization',
    );
    expect(screen.getByLabelText('Organization name')).toHaveValue('Wash');
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('private failure')).not.toBeInTheDocument();
  });
  it('announces list loading followed by sanitized failure', async () => {
    const pending = deferred<OrganizationListResponse>();
    vi.spyOn(organizationsApi, 'listOwnedOrganizations').mockReturnValue(pending.promise);
    setup();
    await screen.findByText('Loading your organizations…');
    await act(async () => pending.reject(new Error('private failure')));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not load your organizations.',
    );
  });
  it('renders owner detail as ordinary text with scoped key and next-slice notice', async () => {
    vi.spyOn(organizationsApi, 'getOwnedOrganization').mockResolvedValue({
      organization: organizationA,
    });
    const view = setup(<OrganizationDetail organizationId={organizationA.id} />);
    await screen.findByRole('heading', { name: 'Alpha Wash' });
    expect(screen.getByText('Branches will be added in the next version.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to your organizations' })).toHaveAttribute(
      'href',
      '/business/organizations',
    );
    expect(
      view.client
        .getQueryCache()
        .getAll()
        .map(({ queryKey }) => queryKey),
    ).toEqual([organizationDetailKey(userA.id, organizationA.id)]);
    expect(document.querySelector('.organization-description b')).toBeNull();
  });
  it.each([404, 500])('renders safe detail %i without retry', async (status) => {
    const detail = vi
      .spyOn(organizationsApi, 'getOwnedOrganization')
      .mockRejectedValue(
        new api.ApiClientError(
          'private detail',
          status,
          status === 404 ? 'ORGANIZATION_NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
        ),
      );
    setup(<OrganizationDetail organizationId={organizationA.id} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      status === 404
        ? 'This organization is not available.'
        : 'We could not load your organization.',
    );
    expect(detail).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid detail address without transport', async () => {
    const detail = vi.spyOn(organizationsApi, 'getOwnedOrganization');
    setup(<OrganizationDetail organizationId="bad" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid organization address.');
    expect(detail).not.toHaveBeenCalled();
  });
  it.each(['list', 'detail'] as const)(
    'immediately clears both cache families during account switch and ignores delayed old %s success',
    async (route) => {
      const pending = deferred<OrganizationListResponse>();
      const pendingDetail = deferred<OrganizationDetailResponse>();
      vi.spyOn(organizationsApi, 'listOwnedOrganizations').mockImplementation((token) =>
        token === 'test-only-beta-token'
          ? Promise.resolve({ organizations: [organizationB] })
          : pending.promise,
      );
      vi.spyOn(organizationsApi, 'getOwnedOrganization').mockImplementation((token) =>
        token === 'test-only-beta-token'
          ? Promise.reject(new api.ApiClientError('unavailable', 404, 'ORGANIZATION_NOT_FOUND'))
          : pendingDetail.promise,
      );
      const view = setup(
        route === 'list' ? (
          <Organizations />
        ) : (
          <OrganizationDetail organizationId={organizationA.id} />
        ),
      );
      await screen.findByText(
        route === 'list' ? 'Loading your organizations…' : 'Loading your organization…',
      );
      const extraKey =
        route === 'list'
          ? organizationDetailKey(userA.id, organizationA.id)
          : organizationListKey(userA.id);
      view.client.setQueryData(
        extraKey,
        route === 'list' ? { organization: organizationA } : { organizations: [organizationA] },
      );
      const syncing = deferred<RefreshResponse>();
      view.refresh.mockReturnValueOnce(syncing.promise);
      view.emit('session-changed');
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Organization name')).not.toBeInTheDocument();
      expect(
        view.client
          .getQueryCache()
          .getAll()
          .some(({ queryKey }) => queryKey[1] === userA.id),
      ).toBe(false);
      await act(async () => syncing.resolve(refreshed('test-only-beta-token')));
      await screen.findByText('Beta');
      await act(async () => {
        pending.resolve({ organizations: [organizationA] });
        pendingDetail.resolve({ organization: organizationA });
      });
      expect(screen.queryByText('Alpha Wash')).not.toBeInTheDocument();
      expect(
        view.client
          .getQueryCache()
          .getAll()
          .some(({ queryKey }) => queryKey[1] === userA.id),
      ).toBe(false);
      if (route === 'list') await screen.findByRole('link', { name: 'Beta Wash' });
    },
  );
  it.each([401, 404, 500])(
    'stale %i list/detail failures cannot invalidate the new account',
    async (status) => {
      const pending = deferred<OrganizationListResponse>();
      const pendingDetail = deferred<OrganizationDetailResponse>();
      vi.spyOn(organizationsApi, 'listOwnedOrganizations').mockImplementation((token) =>
        token === 'test-only-beta-token'
          ? Promise.resolve({ organizations: [organizationB] })
          : pending.promise,
      );
      vi.spyOn(organizationsApi, 'getOwnedOrganization').mockImplementation((token) =>
        token === 'test-only-beta-token'
          ? Promise.resolve({ organization: organizationB })
          : pendingDetail.promise,
      );
      const view = setup(
        <>
          <Organizations />
          <OrganizationDetail organizationId={organizationA.id} />
        </>,
      );
      await screen.findByText('Loading your organizations…');
      await screen.findByText('Loading your organization…');
      view.refresh.mockResolvedValueOnce(refreshed('test-only-beta-token'));
      view.emit('session-changed');
      await screen.findByRole('link', { name: 'Beta Wash' });
      const failure = new api.ApiClientError(
        'old failure',
        status,
        status === 401
          ? 'AUTHENTICATION_REQUIRED'
          : status === 404
            ? 'ORGANIZATION_NOT_FOUND'
            : 'INTERNAL_SERVER_ERROR',
      );
      await act(async () => {
        pending.reject(failure);
        pendingDetail.reject(failure);
      });
      expect(view.auth.currentUser?.id).toBe(userB.id);
      expect(view.auth.status).toBe('authenticated');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );
  it.each(['success', '401', '404', '500'])(
    'ignores stale creation %s after account switch',
    async (outcome) => {
      vi.spyOn(organizationsApi, 'listOwnedOrganizations').mockImplementation(async (token) => ({
        organizations: token === 'test-only-beta-token' ? [organizationB] : [],
      }));
      const pending = deferred<OrganizationDetailResponse>();
      vi.spyOn(organizationsApi, 'createOrganization').mockReturnValue(pending.promise);
      const view = setup();
      fireEvent.change(await screen.findByLabelText('Organization name'), {
        target: { value: 'Alpha Wash' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
      await screen.findByText('Creating your organization…');
      view.refresh.mockResolvedValueOnce(refreshed('test-only-beta-token'));
      view.emit('session-changed');
      await screen.findByRole('link', { name: 'Beta Wash' });
      await act(async () => {
        if (outcome === 'success') pending.resolve({ organization: organizationA });
        else
          pending.reject(
            new api.ApiClientError(
              'old failure',
              Number(outcome),
              outcome === '401' ? 'AUTHENTICATION_REQUIRED' : 'ORGANIZATION_NOT_FOUND',
            ),
          );
      });
      expect(view.auth.currentUser?.id).toBe(userB.id);
      expect(screen.queryByText('Organization created.')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Organization name')).toHaveValue('');
      expect(view.client.getQueryData(organizationListKey(userB.id))).toEqual({
        organizations: [organizationB],
      });
    },
  );
  it('remote logout hides/reset forms and removes both caches; late creation cannot restore UI', async () => {
    vi.spyOn(organizationsApi, 'listOwnedOrganizations').mockResolvedValue({
      organizations: [organizationA],
    });
    const pending = deferred<OrganizationDetailResponse>();
    vi.spyOn(organizationsApi, 'createOrganization').mockReturnValue(pending.promise);
    const view = setup();
    await screen.findByRole('link', { name: 'Alpha Wash' });
    view.client.setQueryData(organizationDetailKey(userA.id, organizationA.id), {
      organization: organizationA,
    });
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Wash' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    await screen.findByText('Creating your organization…');
    view.emit('logout');
    expect(screen.queryByLabelText('Organization name')).not.toBeInTheDocument();
    expect(screen.queryByText('Alpha Wash')).not.toBeInTheDocument();
    expect(view.client.getQueryCache().getAll()).toHaveLength(0);
    await act(async () => pending.resolve({ organization: organizationA }));
    expect(screen.queryByText('Organization created.')).not.toBeInTheDocument();
    expect(view.auth.currentUser).toBeNull();
  });
  it('current authentication-required response clears protected organization UI without retry', async () => {
    const list = vi
      .spyOn(organizationsApi, 'listOwnedOrganizations')
      .mockRejectedValue(
        new api.ApiClientError('Authentication is required', 401, 'AUTHENTICATION_REQUIRED'),
      );
    const view = setup();
    await screen.findByText('Sign in to create and view your organizations.');
    expect(view.auth.status).toBe('unauthenticated');
    expect(list).toHaveBeenCalledTimes(1);
    expect(view.client.getQueryCache().getAll()).toHaveLength(0);
  });
});
