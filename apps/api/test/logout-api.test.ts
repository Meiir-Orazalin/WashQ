import { randomBytes } from 'node:crypto';
import { type INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginCustomerUseCase } from '../src/auth/application/login-customer.use-case.js';
import { GetCurrentUserUseCase } from '../src/auth/application/get-current-user.use-case.js';
import {
  LogoutCurrentSessionUseCase,
  type LogoutCurrentSessionCommand,
} from '../src/auth/application/logout-current-session.use-case.js';
import { RegisterCustomerUseCase } from '../src/auth/application/register-customer.use-case.js';
import { RotateRefreshSessionUseCase } from '../src/auth/application/rotate-refresh-session.use-case.js';
import { AuthController } from '../src/auth/presentation/auth.controller.js';
import { RefreshRequestOriginPolicy } from '../src/auth/presentation/refresh-request-origin.policy.js';
import {
  RefreshTokenCookiePolicy,
  refreshTokenCookieName,
} from '../src/auth/presentation/refresh-token-cookie.policy.js';
import { HttpExceptionFilter } from '../src/http/http-exception.filter.js';
import { requestIdMiddleware } from '../src/http/request-id.middleware.js';

type FailureMode = 'hashing' | 'persistence' | null;

const allowedOrigin = 'http://localhost:3000';
const disallowedOrigin = 'https://attacker.example';
const refreshTokenLifetimeSeconds = 2_592_000;
const passwordMarker = 'never-log-this-password';
const signingSecretMarker = 'never-log-this-signing-secret';

function opaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

function getClearedRefreshCookie(value: string | string[] | undefined): string {
  const cookies = typeof value === 'string' ? [value] : value;
  const cookie = cookies?.find((candidate) => candidate.startsWith(`${refreshTokenCookieName}=`));

  if (!cookie) {
    throw new Error('Expected the refresh cookie to be cleared');
  }

  return cookie;
}

describe('POST /api/v1/auth/logout', () => {
  let app: INestApplication;
  let failureMode: FailureMode;
  let executeCalls: LogoutCurrentSessionCommand[];
  let rawRefreshToken: string;

  async function createLogoutApp(
    nodeEnv: 'test' | 'production' = 'test',
  ): Promise<INestApplication> {
    const logoutCurrentSession = {
      execute: async (command: LogoutCurrentSessionCommand): Promise<void> => {
        executeCalls.push(command);

        if (failureMode === 'hashing') {
          throw new Error(`hashing failed for ${command.rawRefreshToken}`);
        }

        if (failureMode === 'persistence') {
          throw new Error(
            `database constraint failed for ${command.rawRefreshToken} using ${signingSecretMarker}`,
          );
        }
      },
    };
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: RegisterCustomerUseCase, useValue: { execute: () => Promise.reject() } },
        { provide: LoginCustomerUseCase, useValue: { execute: () => Promise.reject() } },
        {
          provide: GetCurrentUserUseCase,
          useValue: { execute: async () => Promise.reject(new Error('not used')) },
        },
        {
          provide: RotateRefreshSessionUseCase,
          useValue: { execute: () => Promise.reject() },
        },
        { provide: LogoutCurrentSessionUseCase, useValue: logoutCurrentSession },
        {
          provide: RefreshRequestOriginPolicy,
          useValue: new RefreshRequestOriginPolicy([allowedOrigin]),
        },
        {
          provide: RefreshTokenCookiePolicy,
          useValue: new RefreshTokenCookiePolicy({
            nodeEnv,
            refreshTokenLifetimeSeconds,
          }),
        },
      ],
    }).compile();
    const testApp = module.createNestApplication();
    testApp.enableCors({
      credentials: true,
      origin: [allowedOrigin],
    });
    testApp.setGlobalPrefix('api/v1');
    testApp.use(requestIdMiddleware);
    testApp.useGlobalFilters(new HttpExceptionFilter());
    await testApp.init();
    return testApp;
  }

  beforeEach(async () => {
    failureMode = null;
    executeCalls = [];
    rawRefreshToken = opaqueToken();
    app = await createLogoutApp();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('returns an empty HTTP 204 and clears the cookie for a valid session token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', `${refreshTokenCookieName}=${rawRefreshToken}`)
      .expect(204);
    const cookie = getClearedRefreshCookie(response.headers['set-cookie']);

    expect(response.text).toBe('');
    expect(response.body).toEqual({});
    expect(executeCalls).toEqual([{ rawRefreshToken }]);
    expect(cookie).toMatch(new RegExp(`^${refreshTokenCookieName}=;`));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(cookie).not.toContain('Domain=');
    expect(cookie).not.toContain(rawRefreshToken);
  });

  it('uses Secure when clearing the cookie in production', async () => {
    await app.close();
    app = await createLogoutApp('production');

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', `${refreshTokenCookieName}=${rawRefreshToken}`)
      .expect(204);

    expect(getClearedRefreshCookie(response.headers['set-cookie'])).toContain('Secure');
  });

  it.each([
    { state: 'missing cookie', token: undefined },
    { state: 'malformed token', token: 'malformed' },
    { state: 'unknown token', token: opaqueToken() },
    { state: 'expired token', token: opaqueToken() },
    { state: 'already-revoked token', token: opaqueToken() },
    { state: 'rotated old token', token: opaqueToken() },
  ])('returns the same empty 204 and clears the cookie for a $state', async ({ token }) => {
    let pendingRequest = request(app.getHttpServer()).post('/api/v1/auth/logout');
    if (token) {
      pendingRequest = pendingRequest.set('Cookie', `${refreshTokenCookieName}=${token}`);
    }

    const response = await pendingRequest.expect(204);

    expect(response.text).toBe('');
    expect(response.body).toEqual({});
    expect(getClearedRefreshCookie(response.headers['set-cookie'])).toMatch(
      new RegExp(`^${refreshTokenCookieName}=;`),
    );
    expect(executeCalls.at(-1)).toEqual({ rawRefreshToken: token });
  });

  it('accepts an allowed browser Origin with credentialed CORS', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', allowedOrigin)
      .set('Cookie', `${refreshTokenCookieName}=${rawRefreshToken}`)
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(executeCalls).toEqual([{ rawRefreshToken }]);
  });

  it('accepts an absent Origin for trusted non-browser clients', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', `${refreshTokenCookieName}=${rawRefreshToken}`)
      .expect(204);

    expect(executeCalls).toEqual([{ rawRefreshToken }]);
  });

  it('rejects a disallowed Origin without revoking or clearing and without echoing it', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', disallowedOrigin)
      .set('Cookie', `${refreshTokenCookieName}=${rawRefreshToken}`)
      .expect(403);

    expect(response.body.error).toEqual({
      code: 'ORIGIN_NOT_ALLOWED',
      message: 'The request origin is not allowed',
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(executeCalls).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toContain(disallowedOrigin);
  });

  it.each(['hashing', 'persistence'] as const)(
    'returns a sanitized 500 and still clears the cookie after an accepted %s failure',
    async (mode) => {
      failureMode = mode;

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', `${refreshTokenCookieName}=${rawRefreshToken}`)
        .send({ password: passwordMarker })
        .expect(500);

      expect(response.body.error).toEqual({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      });
      expect(getClearedRefreshCookie(response.headers['set-cookie'])).toMatch(
        new RegExp(`^${refreshTokenCookieName}=;`),
      );
      expect(JSON.stringify(response.body)).not.toContain(rawRefreshToken);
      expect(JSON.stringify(response.body)).not.toContain(passwordMarker);
      expect(JSON.stringify(response.body)).not.toContain(signingSecretMarker);
      expect(JSON.stringify(response.body)).not.toMatch(/constraint|database|hashing|stack/i);
    },
  );

  it('does not log the refresh token, password, or signing secret on failure', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error');
    failureMode = 'persistence';

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', `${refreshTokenCookieName}=${rawRefreshToken}`)
      .send({ password: passwordMarker })
      .expect(500);

    const logs = JSON.stringify(errorLog.mock.calls);
    expect(logs).not.toContain(rawRefreshToken);
    expect(logs).not.toContain(passwordMarker);
    expect(logs).not.toContain(signingSecretMarker);
  });

  it('documents cookie logout, empty success, Origin protection, and sanitized errors', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addCookieAuth(refreshTokenCookieName, { type: 'apiKey', in: 'cookie' }, 'refresh-cookie')
        .build(),
    );
    const operation = document.paths['/api/v1/auth/logout']?.post;

    expect(operation?.security).toEqual([{ 'refresh-cookie': [] }]);
    expect(operation?.requestBody).toBeUndefined();
    expect(operation?.responses).toHaveProperty('204');
    expect(operation?.responses).toHaveProperty('403');
    expect(operation?.responses).toHaveProperty('500');
    expect(operation?.responses).not.toHaveProperty('200');
    expect(operation?.description).toContain('Origin');
    expect(operation?.description).toContain('clears the cookie');
    expect(operation?.description).toContain('access tokens remain valid until expiration');
    expect(JSON.stringify(operation)).not.toContain(rawRefreshToken);
  });
});
