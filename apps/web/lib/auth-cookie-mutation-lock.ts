export const authCookieMutationLockName = 'washqueue-auth-cookie-mutation-v1';
export const authCoordinationUnavailableCode = 'AUTH_COORDINATION_UNAVAILABLE';

interface AuthCookieLockManager {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T>;
}

type ResolveAuthCookieLockManager = () => AuthCookieLockManager | undefined;

export interface AuthCookieMutationLock {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
}

export class AuthCoordinationUnavailableError extends Error {
  readonly code = authCoordinationUnavailableCode;

  constructor() {
    super('Authentication coordination is unavailable');
    this.name = 'AuthCoordinationUnavailableError';
  }
}

export function createAuthCookieMutationLock(
  resolveLockManager: ResolveAuthCookieLockManager = resolveBrowserLockManager,
): AuthCookieMutationLock {
  return {
    async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
      let lockManager: AuthCookieLockManager | undefined;
      try {
        lockManager = resolveLockManager();
      } catch {
        throw new AuthCoordinationUnavailableError();
      }

      if (!lockManager) {
        throw new AuthCoordinationUnavailableError();
      }

      let operationStarted = false;
      try {
        return await lockManager.request(
          authCookieMutationLockName,
          { mode: 'exclusive' },
          async () => {
            operationStarted = true;
            return operation();
          },
        );
      } catch (error) {
        if (operationStarted) {
          throw error;
        }

        throw new AuthCoordinationUnavailableError();
      }
    },
  };
}

function resolveBrowserLockManager(): AuthCookieLockManager | undefined {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return undefined;
  }

  return {
    request: (name, options, callback) =>
      navigator.locks.request(name, options, async () => callback()),
  };
}

export const authCookieMutationLock = createAuthCookieMutationLock();
