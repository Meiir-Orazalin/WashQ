'use client';

import type { LoginUser } from '@washqueue/contracts';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type AuthenticationStatus = 'unauthenticated' | 'authenticating' | 'authenticated' | 'error';

export interface AuthenticationState {
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  currentUser: LoginUser | null;
  status: AuthenticationStatus;
}

interface AuthenticationContextValue extends AuthenticationState {
  beginAuthentication(): void;
  stageAccessToken(accessToken: string, accessTokenExpiresAt: string): void;
  completeAuthentication(currentUser: LoginUser): void;
  failAuthentication(): void;
}

const initialAuthenticationState: AuthenticationState = {
  accessToken: null,
  accessTokenExpiresAt: null,
  currentUser: null,
  status: 'unauthenticated',
};

const AuthenticationContext = createContext<AuthenticationContextValue | null>(null);

export function AuthenticationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthenticationState>(initialAuthenticationState);

  const beginAuthentication = useCallback(() => {
    setState({ ...initialAuthenticationState, status: 'authenticating' });
  }, []);

  const stageAccessToken = useCallback((accessToken: string, accessTokenExpiresAt: string) => {
    setState({
      accessToken,
      accessTokenExpiresAt,
      currentUser: null,
      status: 'authenticating',
    });
  }, []);

  const completeAuthentication = useCallback((currentUser: LoginUser) => {
    setState((current) => ({
      ...current,
      currentUser,
      status: 'authenticated',
    }));
  }, []);

  const failAuthentication = useCallback(() => {
    setState({ ...initialAuthenticationState, status: 'error' });
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      beginAuthentication,
      stageAccessToken,
      completeAuthentication,
      failAuthentication,
    }),
    [state, beginAuthentication, stageAccessToken, completeAuthentication, failAuthentication],
  );

  return <AuthenticationContext.Provider value={value}>{children}</AuthenticationContext.Provider>;
}

export function useAuthentication(): AuthenticationContextValue {
  const authentication = useContext(AuthenticationContext);
  if (!authentication) {
    throw new Error('useAuthentication must be used within AuthenticationProvider');
  }

  return authentication;
}
