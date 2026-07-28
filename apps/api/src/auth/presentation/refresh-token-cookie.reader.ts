import { parseCookie } from 'cookie';
import { refreshTokenCookieName } from './refresh-token-cookie.policy.js';

export function readRefreshTokenCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  try {
    return parseCookie(cookieHeader)[refreshTokenCookieName];
  } catch {
    return undefined;
  }
}
