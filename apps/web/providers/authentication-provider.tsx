'use client';

import type { LoginUser } from '@washqueue/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  getExpirationDelay,
  getProactiveRefreshDelay,
  isWithinRefreshWindow,
  requireFutureAccessTokenExpiration,
} from '@/lib/access-token-expiration';
import { ApiClientError, getCurrentUser } from '@/lib/api-client';
import {
  refreshCoordinator as defaultRefreshCoordinator,
  type RefreshCoordinator,
} from '@/lib/refresh-coordinator';

export type AuthenticationStatus =
  'initializing' | 'unauthenticated' | 'authenticating' | 'authenticated' | 'error';

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
  continueUnauthenticated(): void;
}

interface AuthenticationProviderProps {
  children: ReactNode;
  refreshCoordinator?: RefreshCoordinator;
}

type RefreshScheduleMode = 'proactive' | 'indeterminate';

const emptyAuthenticationState = {
  accessToken: null,
  accessTokenExpiresAt: null,
  currentUser: null,
} as const;

const initialAuthenticationState: AuthenticationState = {
  ...emptyAuthenticationState,
  status: 'initializing',
};

const AuthenticationContext = createContext<AuthenticationContextValue | null>(null);

export function AuthenticationProvider({
  children,
  refreshCoordinator = defaultRefreshCoordinator,
}: AuthenticationProviderProps) {
  const [state, setState] = useState<AuthenticationState>(initialAuthenticationState);
  const [refreshScheduleMode, setRefreshScheduleMode] = useState<RefreshScheduleMode>('proactive');
  const stateRef = useRef(state);
  const mountedRef = useRef(false);
  const operationGenerationRef = useRef(0);
  const indeterminateTokenRef = useRef<string | null>(null);
  const activeProactiveRefreshRef = useRef<Promise<void> | null>(null);
  stateRef.current = state;

  const clearAuthentication = useCallback((status: 'unauthenticated' | 'error') => {
    operationGenerationRef.current += 1;
    indeterminateTokenRef.current = null;
    setRefreshScheduleMode('proactive');
    setState({ ...emptyAuthenticationState, status });
  }, []);

  const beginAuthentication = useCallback(() => {
    operationGenerationRef.current += 1;
    indeterminateTokenRef.current = null;
    setRefreshScheduleMode('proactive');
    setState({ ...emptyAuthenticationState, status: 'authenticating' });
  }, []);

  const stageAccessToken = useCallback((accessToken: string, accessTokenExpiresAt: string) => {
    requireFutureAccessTokenExpiration(accessTokenExpiresAt);
    indeterminateTokenRef.current = null;
    setRefreshScheduleMode('proactive');
    setState({
      accessToken,
      accessTokenExpiresAt,
      currentUser: null,
      status: 'authenticating',
    });
  }, []);

  const completeAuthentication = useCallback((currentUser: LoginUser) => {
    indeterminateTokenRef.current = null;
    setRefreshScheduleMode('proactive');
    setState((current) => ({
      ...current,
      currentUser,
      status: 'authenticated',
    }));
  }, []);

  const failAuthentication = useCallback(() => {
    clearAuthentication('error');
  }, [clearAuthentication]);

  const continueUnauthenticated = useCallback(() => {
    clearAuthentication('unauthenticated');
  }, [clearAuthentication]);

  useEffect(() => {
    mountedRef.current = true;
    let subscribed = true;
    const generation = ++operationGenerationRef.current;

    async function restoreSession() {
      try {
        const refreshed = await refreshCoordinator.refresh();
        const expiresAt = requireFutureAccessTokenExpiration(refreshed.accessTokenExpiresAt);

        if (!isCurrentOperation(subscribed, generation)) {
          return;
        }

        setState({
          accessToken: refreshed.accessToken,
          accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
          currentUser: null,
          status: 'initializing',
        });

        const currentUser = await getCurrentUser(refreshed.accessToken);
        if (!isCurrentOperation(subscribed, generation)) {
          return;
        }

        if (expiresAt <= Date.now()) {
          clearAuthentication('error');
          return;
        }

        indeterminateTokenRef.current = null;
        setRefreshScheduleMode('proactive');
        setState({
          accessToken: refreshed.accessToken,
          accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
          currentUser: currentUser.user,
          status: 'authenticated',
        });
      } catch (error) {
        if (!isCurrentOperation(subscribed, generation)) {
          return;
        }

        if (isInvalidRefreshSession(error) || isAuthenticationRequired(error)) {
          clearAuthentication('unauthenticated');
          return;
        }

        clearAuthentication('error');
      }
    }

    function isCurrentOperation(subscriberActive: boolean, operationGeneration: number) {
      return (
        subscriberActive &&
        mountedRef.current &&
        operationGenerationRef.current === operationGeneration
      );
    }

    void restoreSession();

    return () => {
      subscribed = false;
      mountedRef.current = false;
    };
  }, [clearAuthentication, refreshCoordinator]);

  const runProactiveRefresh = useCallback((): Promise<void> => {
    const snapshot = stateRef.current;
    if (
      snapshot.status !== 'authenticated' ||
      !snapshot.accessToken ||
      !snapshot.accessTokenExpiresAt ||
      indeterminateTokenRef.current === snapshot.accessToken
    ) {
      return Promise.resolve();
    }

    if (activeProactiveRefreshRef.current) {
      return activeProactiveRefreshRef.current;
    }

    const generation = operationGenerationRef.current;
    const originalToken = snapshot.accessToken;
    const originalExpiration = Date.parse(snapshot.accessTokenExpiresAt);

    const refreshOperation = (async () => {
      try {
        const refreshed = await refreshCoordinator.refresh();
        requireFutureAccessTokenExpiration(refreshed.accessTokenExpiresAt);

        if (!isCurrentAuthenticatedToken(generation, originalToken)) {
          return;
        }

        indeterminateTokenRef.current = null;
        setRefreshScheduleMode('proactive');
        setState((current) =>
          current.status === 'authenticated' && current.accessToken === originalToken
            ? {
                ...current,
                accessToken: refreshed.accessToken,
                accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
              }
            : current,
        );
      } catch (error) {
        if (!isCurrentAuthenticatedToken(generation, originalToken)) {
          return;
        }

        if (isInvalidRefreshSession(error)) {
          clearAuthentication('unauthenticated');
          return;
        }

        if (Number.isFinite(originalExpiration) && originalExpiration > Date.now()) {
          indeterminateTokenRef.current = originalToken;
          setRefreshScheduleMode('indeterminate');
          return;
        }

        clearAuthentication('error');
      }
    })();

    activeProactiveRefreshRef.current = refreshOperation;
    void refreshOperation.finally(() => {
      if (activeProactiveRefreshRef.current === refreshOperation) {
        activeProactiveRefreshRef.current = null;
      }
    });

    return refreshOperation;
  }, [clearAuthentication, refreshCoordinator]);

  function isCurrentAuthenticatedToken(generation: number, accessToken: string) {
    const current = stateRef.current;
    return (
      mountedRef.current &&
      operationGenerationRef.current === generation &&
      current.status === 'authenticated' &&
      current.accessToken === accessToken
    );
  }

  useEffect(() => {
    if (state.status !== 'authenticated' || !state.accessToken || !state.accessTokenExpiresAt) {
      return;
    }

    const expiration = Date.parse(state.accessTokenExpiresAt);
    if (!Number.isFinite(expiration)) {
      clearAuthentication('error');
      return;
    }

    const token = state.accessToken;
    const indeterminate =
      refreshScheduleMode === 'indeterminate' && indeterminateTokenRef.current === token;
    const delay = indeterminate
      ? getExpirationDelay(expiration)
      : getProactiveRefreshDelay(expiration);
    const timer = window.setTimeout(() => {
      if (indeterminate) {
        if (stateRef.current.accessToken === token) {
          clearAuthentication('error');
        }
        return;
      }

      void runProactiveRefresh();
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    clearAuthentication,
    refreshScheduleMode,
    runProactiveRefresh,
    state.accessToken,
    state.accessTokenExpiresAt,
    state.status,
  ]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') {
        return;
      }

      const current = stateRef.current;
      if (
        current.status !== 'authenticated' ||
        !current.accessToken ||
        !current.accessTokenExpiresAt
      ) {
        return;
      }

      const expiration = Date.parse(current.accessTokenExpiresAt);
      if (!Number.isFinite(expiration)) {
        clearAuthentication('error');
        return;
      }

      if (indeterminateTokenRef.current === current.accessToken) {
        if (expiration <= Date.now()) {
          clearAuthentication('error');
        }
        return;
      }

      if (isWithinRefreshWindow(expiration)) {
        void runProactiveRefresh();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [clearAuthentication, runProactiveRefresh]);

  const value = useMemo(
    () => ({
      ...state,
      beginAuthentication,
      stageAccessToken,
      completeAuthentication,
      failAuthentication,
      continueUnauthenticated,
    }),
    [
      state,
      beginAuthentication,
      stageAccessToken,
      completeAuthentication,
      failAuthentication,
      continueUnauthenticated,
    ],
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

function isInvalidRefreshSession(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 401 &&
    error.code === 'INVALID_REFRESH_SESSION'
  );
}

function isAuthenticationRequired(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 401 &&
    error.code === 'AUTHENTICATION_REQUIRED'
  );
}
