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
import {
  AuthCoordinationUnavailableError,
  authCookieMutationLock,
} from '@/lib/auth-cookie-mutation-lock';
import {
  createAuthLifecycleChannel,
  type AuthLifecycleChannel,
  type AuthLifecycleEvent,
} from '@/lib/auth-lifecycle-channel';
import {
  ApiClientError,
  getCurrentUser,
  logoutCurrentSession as requestLogoutCurrentSession,
} from '@/lib/api-client';
import {
  refreshCoordinator as defaultRefreshCoordinator,
  type RefreshCoordinator,
} from '@/lib/refresh-coordinator';

export type AuthenticationStatus =
  | 'initializing'
  | 'synchronizing'
  | 'unauthenticated'
  | 'authenticating'
  | 'authenticated'
  | 'logging-out'
  | 'logout-error'
  | 'coordination-error'
  | 'lifecycle-error'
  | 'error';

export interface AuthenticationState {
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  currentUser: LoginUser | null;
  status: AuthenticationStatus;
}

interface AuthenticationContextValue extends AuthenticationState {
  beginAuthentication(): number | null;
  isAuthenticationOperationCurrent(operationGeneration: number): boolean;
  completeAuthentication(
    accessToken: string,
    accessTokenExpiresAt: string,
    currentUser: LoginUser,
    operationGeneration: number,
  ): boolean;
  failAuthentication(operationGeneration: number, status?: 'error' | 'coordination-error'): void;
  continueUnauthenticated(): void;
  logout(): Promise<void>;
  continueAfterLogoutError(): void;
}

interface AuthenticationProviderProps {
  children: ReactNode;
  refreshCoordinator?: RefreshCoordinator;
  lifecycleChannelFactory?: () => AuthLifecycleChannel | null;
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
  lifecycleChannelFactory = createAuthLifecycleChannel,
}: AuthenticationProviderProps) {
  const [state, setState] = useState<AuthenticationState>(initialAuthenticationState);
  const [refreshScheduleMode, setRefreshScheduleMode] = useState<RefreshScheduleMode>('proactive');
  const stateRef = useRef(state);
  const mountedRef = useRef(false);
  const operationGenerationRef = useRef(0);
  const lifecycleChannelRef = useRef<AuthLifecycleChannel | null>(null);
  const pendingLifecycleBroadcastRef = useRef<{
    type: AuthLifecycleEvent['type'];
    generation: number;
  } | null>(null);
  const explicitLoginIntentRef = useRef(false);
  const deferredSessionChangeRef = useRef(false);
  const indeterminateTokenRef = useRef<string | null>(null);
  const activeProactiveRefreshRef = useRef<Promise<void> | null>(null);
  const activeLogoutRef = useRef<Promise<void> | null>(null);
  const logoutIntentRef = useRef(false);
  stateRef.current = state;

  const clearAuthentication = useCallback(
    (
      status:
        'unauthenticated' | 'error' | 'logout-error' | 'coordination-error' | 'lifecycle-error',
    ) => {
      operationGenerationRef.current += 1;
      pendingLifecycleBroadcastRef.current = null;
      explicitLoginIntentRef.current = false;
      indeterminateTokenRef.current = null;
      setRefreshScheduleMode('proactive');
      setState({ ...emptyAuthenticationState, status });
    },
    [],
  );

  const beginAuthentication = useCallback(() => {
    if (!lifecycleChannelRef.current) {
      clearAuthentication('lifecycle-error');
      return null;
    }

    operationGenerationRef.current += 1;
    const generation = operationGenerationRef.current;
    logoutIntentRef.current = false;
    explicitLoginIntentRef.current = true;
    pendingLifecycleBroadcastRef.current = null;
    indeterminateTokenRef.current = null;
    setRefreshScheduleMode('proactive');
    setState({ ...emptyAuthenticationState, status: 'authenticating' });
    return generation;
  }, [clearAuthentication]);

  const completeAuthentication = useCallback(
    (
      accessToken: string,
      accessTokenExpiresAt: string,
      currentUser: LoginUser,
      operationGeneration: number,
    ) => {
      requireFutureAccessTokenExpiration(accessTokenExpiresAt);
      if (
        !mountedRef.current ||
        logoutIntentRef.current ||
        operationGenerationRef.current !== operationGeneration
      ) {
        return false;
      }

      explicitLoginIntentRef.current = false;
      indeterminateTokenRef.current = null;
      setRefreshScheduleMode('proactive');
      setState({
        accessToken,
        accessTokenExpiresAt,
        currentUser,
        status: 'authenticated',
      });
      pendingLifecycleBroadcastRef.current = {
        type: 'session-changed',
        generation: operationGeneration,
      };
      return true;
    },
    [],
  );

  const isAuthenticationOperationCurrent = useCallback((operationGeneration: number) => {
    return (
      mountedRef.current &&
      explicitLoginIntentRef.current &&
      !logoutIntentRef.current &&
      operationGenerationRef.current === operationGeneration
    );
  }, []);

  const failAuthentication = useCallback(
    (operationGeneration: number, status: 'error' | 'coordination-error' = 'error') => {
      if (operationGenerationRef.current === operationGeneration && !logoutIntentRef.current) {
        explicitLoginIntentRef.current = false;
        clearAuthentication(status);
      }
    },
    [clearAuthentication],
  );

  const continueUnauthenticated = useCallback(() => {
    logoutIntentRef.current = false;
    clearAuthentication(lifecycleChannelRef.current ? 'unauthenticated' : 'lifecycle-error');
  }, [clearAuthentication]);

  const logout = useCallback((): Promise<void> => {
    if (activeLogoutRef.current) {
      return activeLogoutRef.current;
    }

    logoutIntentRef.current = true;
    explicitLoginIntentRef.current = false;
    deferredSessionChangeRef.current = false;
    pendingLifecycleBroadcastRef.current = null;
    const generation = ++operationGenerationRef.current;
    indeterminateTokenRef.current = null;
    setRefreshScheduleMode('proactive');
    setState({ ...emptyAuthenticationState, status: 'logging-out' });

    const logoutOperation = (async () => {
      await refreshCoordinator.waitForIdle();

      try {
        await authCookieMutationLock.runExclusive(requestLogoutCurrentSession);
      } catch (error) {
        if (mountedRef.current && operationGenerationRef.current === generation) {
          setState({
            ...emptyAuthenticationState,
            status:
              error instanceof AuthCoordinationUnavailableError
                ? 'coordination-error'
                : 'logout-error',
          });
        }
        return;
      }

      if (mountedRef.current && operationGenerationRef.current === generation) {
        logoutIntentRef.current = false;
        pendingLifecycleBroadcastRef.current = { type: 'logout', generation };
        setState({ ...emptyAuthenticationState, status: 'unauthenticated' });
      }
    })();

    activeLogoutRef.current = logoutOperation;
    void logoutOperation.finally(() => {
      if (activeLogoutRef.current === logoutOperation) {
        activeLogoutRef.current = null;
      }
    });

    return logoutOperation;
  }, [refreshCoordinator]);

  const continueAfterLogoutError = useCallback(() => {
    logoutIntentRef.current = false;
    clearAuthentication('unauthenticated');
  }, [clearAuthentication]);

  const synchronizeAfterRemoteSessionChange = useCallback(() => {
    if (!mountedRef.current || logoutIntentRef.current) {
      return;
    }

    const generation = ++operationGenerationRef.current;
    pendingLifecycleBroadcastRef.current = null;
    indeterminateTokenRef.current = null;
    setRefreshScheduleMode('proactive');
    setState({ ...emptyAuthenticationState, status: 'synchronizing' });

    async function synchronize() {
      try {
        const refreshed = await refreshCoordinator.refresh();
        const expiresAt = requireFutureAccessTokenExpiration(refreshed.accessTokenExpiresAt);

        if (!isCurrentStatus(generation, 'synchronizing')) {
          return;
        }

        const currentUser = await getCurrentUser(refreshed.accessToken);
        if (!isCurrentStatus(generation, 'synchronizing')) {
          return;
        }

        if (expiresAt <= Date.now()) {
          clearAuthentication('error');
          return;
        }

        setState({
          accessToken: refreshed.accessToken,
          accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
          currentUser: currentUser.user,
          status: 'authenticated',
        });
      } catch (error) {
        if (!isCurrentStatus(generation, 'synchronizing')) {
          return;
        }

        if (isInvalidRefreshSession(error) || isAuthenticationRequired(error)) {
          clearAuthentication('unauthenticated');
          return;
        }

        if (error instanceof AuthCoordinationUnavailableError) {
          clearAuthentication('coordination-error');
          return;
        }

        clearAuthentication('error');
      }
    }

    void synchronize();
  }, [clearAuthentication, refreshCoordinator]);

  useEffect(() => {
    mountedRef.current = true;
    let subscribed = true;
    const lifecycleChannel = lifecycleChannelFactory();
    if (!lifecycleChannel) {
      clearAuthentication('lifecycle-error');
      return () => {
        subscribed = false;
        mountedRef.current = false;
      };
    }

    lifecycleChannelRef.current = lifecycleChannel;

    function handleLifecycleEvent(event: AuthLifecycleEvent) {
      if (event.type === 'logout') {
        logoutIntentRef.current = true;
        explicitLoginIntentRef.current = false;
        deferredSessionChangeRef.current = false;
        pendingLifecycleBroadcastRef.current = null;
        operationGenerationRef.current += 1;
        indeterminateTokenRef.current = null;
        setRefreshScheduleMode('proactive');
        setState({ ...emptyAuthenticationState, status: 'unauthenticated' });
        return;
      }

      if (logoutIntentRef.current) {
        if (stateRef.current.status !== 'unauthenticated' || activeLogoutRef.current) {
          return;
        }
        logoutIntentRef.current = false;
      }

      if (explicitLoginIntentRef.current) {
        deferredSessionChangeRef.current = true;
        return;
      }

      synchronizeAfterRemoteSessionChange();
    }

    const unsubscribe = lifecycleChannel.subscribe(handleLifecycleEvent);
    const generation = ++operationGenerationRef.current;

    async function restoreSession() {
      try {
        const refreshed = await refreshCoordinator.refresh();
        const expiresAt = requireFutureAccessTokenExpiration(refreshed.accessTokenExpiresAt);

        if (!isCurrentOperation(subscribed, generation)) {
          return;
        }

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

        if (error instanceof AuthCoordinationUnavailableError) {
          clearAuthentication('coordination-error');
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
      unsubscribe();
      lifecycleChannel.close();
      if (lifecycleChannelRef.current === lifecycleChannel) {
        lifecycleChannelRef.current = null;
      }
      mountedRef.current = false;
    };
  }, [
    clearAuthentication,
    lifecycleChannelFactory,
    refreshCoordinator,
    synchronizeAfterRemoteSessionChange,
  ]);

  useEffect(() => {
    const pending = pendingLifecycleBroadcastRef.current;
    if (!pending || pending.generation !== operationGenerationRef.current) {
      return;
    }

    const canPublish =
      (pending.type === 'session-changed' &&
        state.status === 'authenticated' &&
        Boolean(state.accessToken) &&
        Boolean(state.currentUser)) ||
      (pending.type === 'logout' && state.status === 'unauthenticated');
    if (!canPublish) {
      return;
    }

    pendingLifecycleBroadcastRef.current = null;
    const lifecycleChannel = lifecycleChannelRef.current;
    if (!lifecycleChannel) {
      clearAuthentication('lifecycle-error');
      return;
    }

    try {
      if (pending.type === 'session-changed') {
        lifecycleChannel.publishSessionChanged();
      } else {
        lifecycleChannel.publishLogout();
      }
    } catch {
      clearAuthentication('lifecycle-error');
    }
  }, [clearAuthentication, state.accessToken, state.currentUser, state.status]);

  useEffect(() => {
    if (
      !deferredSessionChangeRef.current ||
      explicitLoginIntentRef.current ||
      logoutIntentRef.current
    ) {
      return;
    }

    deferredSessionChangeRef.current = false;
    synchronizeAfterRemoteSessionChange();
  }, [state.status, synchronizeAfterRemoteSessionChange]);

  const runProactiveRefresh = useCallback((): Promise<void> => {
    const snapshot = stateRef.current;
    if (
      logoutIntentRef.current ||
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
      let refreshSucceeded = false;
      try {
        const refreshed = await refreshCoordinator.refresh();
        const expiresAt = requireFutureAccessTokenExpiration(refreshed.accessTokenExpiresAt);
        refreshSucceeded = true;

        if (!isCurrentAuthenticatedToken(generation, originalToken)) {
          return;
        }

        const currentUser = await getCurrentUser(refreshed.accessToken);
        if (!isCurrentAuthenticatedToken(generation, originalToken)) {
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
        if (!isCurrentAuthenticatedToken(generation, originalToken)) {
          return;
        }

        if (isInvalidRefreshSession(error) || isAuthenticationRequired(error)) {
          clearAuthentication('unauthenticated');
          return;
        }

        if (error instanceof AuthCoordinationUnavailableError) {
          clearAuthentication('coordination-error');
          return;
        }

        if (refreshSucceeded) {
          clearAuthentication('error');
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

  function isCurrentStatus(generation: number, status: AuthenticationStatus) {
    return (
      mountedRef.current &&
      operationGenerationRef.current === generation &&
      stateRef.current.status === status
    );
  }

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
        logoutIntentRef.current ||
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
      isAuthenticationOperationCurrent,
      completeAuthentication,
      failAuthentication,
      continueUnauthenticated,
      logout,
      continueAfterLogoutError,
    }),
    [
      state,
      beginAuthentication,
      isAuthenticationOperationCurrent,
      completeAuthentication,
      failAuthentication,
      continueUnauthenticated,
      logout,
      continueAfterLogoutError,
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
