import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthentication, type AuthenticationStatus } from '@/providers/authentication-provider';
import { Organizations } from './organizations';
import { OrganizationDetail } from './organization-detail';
vi.mock('@/providers/authentication-provider', () => ({ useAuthentication: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('organization fail-closed auth states', () => {
  it.each<AuthenticationStatus>([
    'initializing',
    'synchronizing',
    'unauthenticated',
    'authenticating',
    'logging-out',
    'logout-error',
    'coordination-error',
    'lifecycle-error',
    'error',
  ])('hides both routes even with stale currentUser during %s', (status) => {
    const run = vi.fn();
    vi.mocked(useAuthentication).mockReturnValue({
      status,
      currentUser: {
        id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
        firstName: 'Stale Owner',
        lastName: null,
        email: 'stale@example.invalid',
      },
      accessTokenExpiresAt: null,
      runWithAccessToken: run,
      runWithCurrentUserUpdate: vi.fn(),
      beginAuthentication: vi.fn(),
      isAuthenticationOperationCurrent: vi.fn(),
      completeAuthentication: vi.fn(),
      failAuthentication: vi.fn(),
      continueUnauthenticated: vi.fn(),
      logout: vi.fn(),
      continueAfterLogoutError: vi.fn(),
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Organizations />
        <OrganizationDetail organizationId="00000000-0000-4000-8000-000000000001" />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Stale Owner')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Organization name')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Branches will be added in the next version.'),
    ).not.toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });
});
