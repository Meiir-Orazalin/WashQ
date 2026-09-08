import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthentication, type AuthenticationStatus } from '@/providers/authentication-provider';
import { Profile } from './profile';

vi.mock('@/providers/authentication-provider', () => ({ useAuthentication: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('profile fail-closed states', () => {
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
  ])('hides even a stale projection during %s', (status) => {
    const update = vi.fn();
    vi.mocked(useAuthentication).mockReturnValue({
      status,
      currentUser: {
        id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
        firstName: 'Stale',
        lastName: null,
        email: 'stale@example.invalid',
      },
      accessTokenExpiresAt: null,
      runWithAccessToken: vi.fn(),
      runWithCurrentUserUpdate: update,
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
        <Profile />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
    expect(screen.queryByText('stale@example.invalid')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit profile' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });
});
