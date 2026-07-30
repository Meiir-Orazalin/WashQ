export const accessTokenRefreshSafetyWindowMilliseconds = 60_000;

const minimumRefreshDelayMilliseconds = 1_000;
const maximumBrowserTimerDelayMilliseconds = 2_147_483_647;

export class InvalidAccessTokenExpirationError extends Error {
  constructor() {
    super('The access-token expiration is invalid');
    this.name = 'InvalidAccessTokenExpirationError';
  }
}

export function requireFutureAccessTokenExpiration(
  accessTokenExpiresAt: string,
  now = Date.now(),
): number {
  const expiration = Date.parse(accessTokenExpiresAt);

  if (!Number.isFinite(expiration) || expiration <= now) {
    throw new InvalidAccessTokenExpirationError();
  }

  return expiration;
}

export function getProactiveRefreshDelay(expiration: number, now = Date.now()): number {
  const remaining = Math.max(0, expiration - now);
  const delay =
    remaining > accessTokenRefreshSafetyWindowMilliseconds
      ? remaining - accessTokenRefreshSafetyWindowMilliseconds
      : Math.max(minimumRefreshDelayMilliseconds, Math.floor(remaining / 2));

  return Math.min(delay, maximumBrowserTimerDelayMilliseconds);
}

export function getExpirationDelay(expiration: number, now = Date.now()): number {
  return Math.min(Math.max(0, expiration - now), maximumBrowserTimerDelayMilliseconds);
}

export function isWithinRefreshWindow(expiration: number, now = Date.now()): boolean {
  return expiration - now <= accessTokenRefreshSafetyWindowMilliseconds;
}
