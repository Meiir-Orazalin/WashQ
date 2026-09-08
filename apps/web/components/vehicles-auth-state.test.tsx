import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthentication, type AuthenticationStatus } from '@/providers/authentication-provider';
import { Vehicles } from './vehicles';

vi.mock('@/providers/authentication-provider', () => ({
  useAuthentication: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('vehicle fail-closed rendering', () => {
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
  ])(
    'never mounts private data or the form during %s, even with an old user projection',
    (status) => {
      const run = vi.fn();
      vi.mocked(useAuthentication).mockReturnValue({
        status,
        currentUser: {
          id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
          firstName: 'Stale Customer',
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
          <Vehicles />
        </QueryClientProvider>,
      );
      expect(screen.queryByLabelText('Make')).not.toBeInTheDocument();
      expect(screen.queryByText('Stale Customer')).not.toBeInTheDocument();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      expect(run).not.toHaveBeenCalled();
    },
  );
});
