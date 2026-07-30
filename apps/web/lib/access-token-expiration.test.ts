import { describe, expect, it } from 'vitest';
import {
  accessTokenRefreshSafetyWindowMilliseconds,
  getExpirationDelay,
  getProactiveRefreshDelay,
  isWithinRefreshWindow,
  requireFutureAccessTokenExpiration,
} from './access-token-expiration';

describe('access-token expiration policy', () => {
  const now = Date.parse('2026-07-28T12:00:00.000Z');

  it('accepts a future server timestamp and rejects expired values', () => {
    expect(requireFutureAccessTokenExpiration('2026-07-28T12:15:00.000Z', now)).toBe(
      Date.parse('2026-07-28T12:15:00.000Z'),
    );
    expect(() => requireFutureAccessTokenExpiration('2026-07-28T12:00:00.000Z', now)).toThrow(
      'The access-token expiration is invalid',
    );
  });

  it('applies the safety window to normal lifetimes', () => {
    const expiration = now + 15 * 60_000;
    expect(getProactiveRefreshDelay(expiration, now)).toBe(
      15 * 60_000 - accessTokenRefreshSafetyWindowMilliseconds,
    );
  });

  it('handles short and elapsed lifetimes without negative or tight zero-delay timers', () => {
    expect(getProactiveRefreshDelay(now + 10_000, now)).toBe(5_000);
    expect(getProactiveRefreshDelay(now - 1, now)).toBe(1_000);
    expect(getExpirationDelay(now - 1, now)).toBe(0);
  });

  it('caps long browser timers and detects the visibility refresh window', () => {
    expect(getProactiveRefreshDelay(now + 90 * 24 * 60 * 60_000, now)).toBe(2_147_483_647);
    expect(isWithinRefreshWindow(now + 60_000, now)).toBe(true);
    expect(isWithinRefreshWindow(now + 60_001, now)).toBe(false);
  });
});
