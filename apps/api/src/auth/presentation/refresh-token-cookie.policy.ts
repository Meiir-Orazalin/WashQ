import type { CookieOptions } from 'express';

export const refreshTokenCookieName = 'washqueue_refresh';

interface RefreshTokenCookiePolicyOptions {
  nodeEnv: 'development' | 'test' | 'production';
  refreshTokenLifetimeSeconds: number;
}

export class RefreshTokenCookiePolicy {
  private readonly secure: boolean;
  private readonly maxAgeMilliseconds: number;

  constructor(options: RefreshTokenCookiePolicyOptions) {
    this.secure = options.nodeEnv === 'production';
    this.maxAgeMilliseconds = options.refreshTokenLifetimeSeconds * 1_000;
  }

  getOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: this.maxAgeMilliseconds,
      secure: this.secure,
    };
  }

  getClearOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
      secure: this.secure,
    };
  }
}
