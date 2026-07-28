import { randomBytes } from 'node:crypto';
import { type INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { refreshResponseSchema } from '@washqueue/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginCustomerUseCase } from '../src/auth/application/login-customer.use-case.js';
import { GetCurrentUserUseCase } from '../src/auth/application/get-current-user.use-case.js';
import { LogoutCurrentSessionUseCase } from '../src/auth/application/logout-current-session.use-case.js';
import { RegisterCustomerUseCase } from '../src/auth/application/register-customer.use-case.js';
import {
  InvalidRefreshSessionError,
  RotateRefreshSessionUseCase,
  type RotateRefreshSessionCommand,
  type RotateRefreshSessionResult,
} from '../src/auth/application/rotate-refresh-session.use-case.js';
import { AuthController } from '../src/auth/presentation/auth.controller.js';
import { RefreshRequestOriginPolicy } from '../src/auth/presentation/refresh-request-origin.policy.js';
import {
  RefreshTokenCookiePolicy,
  refreshTokenCookieName,
} from '../src/auth/presentation/refresh-token-cookie.policy.js';
import { HttpExceptionFilter } from '../src/http/http-exception.filter.js';
import { requestIdMiddleware } from '../src/http/request-id.middleware.js';
import { ZodValidationPipe } from '../src/http/zod-validation.pipe.js';

type FailureMode = 'access-token' | 'persistence' | null;

const allowedOrigin = 'http://localhost:3000';
const disallowedOrigin = 'https://attacker.example';
const refreshTokenLifetimeSeconds = 2_592_000;
const accessTokenExpiresAt = new Date('2026-07-27T12:15:00.000Z');
const signingSecretMarker = 'never-log-this-access-token-signing-secret';

function opaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

function getRefreshCookie(header: string[] | string | undefined): string {
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = cookies.find((candidate) => candidate.startsWith(`${refreshTokenCookieName}=`));

  if (!cookie) {
    throw new Error('Expected refresh cookie');
  }

  return cookie;
}

describe('POST /api/v1/auth/refresh', () => {
  let app: INestApplication;
  let currentRawToken: string;
  let replacementRawToken: string;
  let invalidRawTokens: Set<string>;
  let failureMode: FailureMode;
  let executeCalls: RotateRefreshSessionCommand[];

  async function createRefreshApp(
    nodeEnv: 'test' | 'production' = 'test',
  ): Promise<INestApplication> {
    const rotateRefreshSession = {
      execute: async (
        command: RotateRefreshSessionCommand,
      ): Promise<RotateRefreshSessionResult> => {
        executeCalls.push(command);

        if (!command.rawRefreshToken || invalidRawTokens.has(command.rawRefreshToken)) {
          throw new InvalidRefreshSessionError();
        }

        if (failureMode === 'access-token') {
          throw new Error(`token signing failed with ${signingSecretMarker}`);
        }

        if (failureMode === 'persistence') {
          throw new Error(
            `refresh persistence failed for ${command.rawRefreshToken} and ${replacementRawToken}`,
          );
        }

        return {
          accessToken: 'signed-access-token',
          accessTokenExpiresAt,
          rawRefreshToken: replacementRawToken,
        };
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
        { provide: RotateRefreshSessionUseCase, useValue: rotateRefreshSession },
        {
          provide: LogoutCurrentSessionUseCase,
          useValue: { execute: async () => Promise.reject(new Error('not used')) },
        },
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
    testApp.useGlobalPipes(new ZodValidationPipe());
    testApp.useGlobalFilters(new HttpExceptionFilter());
    await testApp.init();
    return testApp;
  }

  beforeEach(async () => {
    currentRawToken = opaqueToken();
    replacementRawToken = opaqueToken();
    invalidRawTokens = new Set();
    failureMode = null;
    executeCalls = [];
    app = await createRefreshApp();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('returns HTTP 200 with a contract-valid new access token and no refresh data', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${refreshTokenCookieName}=${currentRawToken}`)
      .expect(200);

    expect(refreshResponseSchema.parse(response.body)).toEqual(response.body);
    expect(response.body).toEqual({
      accessToken: 'signed-access-token',
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
    });
    expect(JSON.stringify(response.body)).not.toContain(replacementRawToken);
    expect(JSON.stringify(response.body)).not.toMatch(/refreshToken|tokenHash|sessionId|familyId/i);
  });

  it('overwrites the token with an HttpOnly same-site path-scoped cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `preference=compact; ${refreshTokenCookieName}=${currentRawToken}`)
      .expect(200);
    const cookie = getRefreshCookie(response.headers['set-cookie']);

    expect(executeCalls).toEqual([{ rawRefreshToken: currentRawToken }]);
    expect(cookie).toContain(`${refreshTokenCookieName}=${replacementRawToken}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain(`Max-Age=${refreshTokenLifetimeSeconds}`);
    expect(cookie).not.toContain('Secure');
    expect(cookie).not.toContain('Domain=');
  });

  it('sets Secure on the rotated cookie in production', async () => {
    await app.close();
    app = await createRefreshApp('production');

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${refreshTokenCookieName}=${currentRawToken}`)
      .expect(200);

    expect(getRefreshCookie(response.headers['set-cookie'])).toContain('Secure');
  });

  it('returns a generic 401 and clears the cookie when it is missing', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/auth/refresh').expect(401);

    expect(response.body.error).toEqual({
      code: 'INVALID_REFRESH_SESSION',
      message: 'The refresh session is invalid',
    });
    expect(getRefreshCookie(response.headers['set-cookie'])).toMatch(
      new RegExp(`^${refreshTokenCookieName}=;`),
    );
  });

  it('returns identical generic 401 responses for unknown, expired, and replayed tokens', async () => {
    const tokens = [opaqueToken(), opaqueToken(), opaqueToken()];
    tokens.forEach((token) => invalidRawTokens.add(token));

    const responses = await Promise.all(
      tokens.map((token) =>
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .set('Cookie', `${refreshTokenCookieName}=${token}`),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
    expect(responses.map((response) => response.body.error)).toEqual([
      responses[0]?.body.error,
      responses[0]?.body.error,
      responses[0]?.body.error,
    ]);
    for (const response of responses) {
      expect(getRefreshCookie(response.headers['set-cookie'])).toMatch(
        new RegExp(`^${refreshTokenCookieName}=;`),
      );
    }
  });

  it('rejects a disallowed browser Origin before reading the session', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', disallowedOrigin)
      .set('Cookie', `${refreshTokenCookieName}=${currentRawToken}`)
      .expect(403);

    expect(response.body.error).toEqual({
      code: 'ORIGIN_NOT_ALLOWED',
      message: 'The request origin is not allowed',
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(executeCalls).toHaveLength(0);
  });

  it('accepts an approved browser Origin with explicit credentialed CORS', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', allowedOrigin)
      .set('Cookie', `${refreshTokenCookieName}=${currentRawToken}`)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('accepts an absent Origin for trusted non-browser clients', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${refreshTokenCookieName}=${currentRawToken}`)
      .expect(200);
  });

  it.each(['persistence', 'access-token'] as const)(
    'returns a sanitized 500 and no Set-Cookie after a %s failure',
    async (mode) => {
      failureMode = mode;

      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${refreshTokenCookieName}=${currentRawToken}`)
        .expect(500);

      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body.error).toEqual({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      });
      expect(JSON.stringify(response.body)).not.toContain(currentRawToken);
      expect(JSON.stringify(response.body)).not.toContain(replacementRawToken);
      expect(JSON.stringify(response.body)).not.toContain(signingSecretMarker);
      expect(response.body).not.toHaveProperty('stack');
    },
  );

  it('does not log the raw refresh tokens or signing secret', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error');
    failureMode = 'persistence';

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${refreshTokenCookieName}=${currentRawToken}`)
      .expect(500);

    failureMode = 'access-token';
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${refreshTokenCookieName}=${currentRawToken}`)
      .expect(500);

    const logs = JSON.stringify(errorLog.mock.calls);
    expect(logs).not.toContain(currentRawToken);
    expect(logs).not.toContain(replacementRawToken);
    expect(logs).not.toContain(signingSecretMarker);
  });

  it('documents cookie authentication, response, generic errors, and origin behavior', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addCookieAuth(refreshTokenCookieName, { type: 'apiKey', in: 'cookie' }, 'refresh-cookie')
        .build(),
    );
    const operation = document.paths['/api/v1/auth/refresh']?.post;

    expect(operation?.security).toEqual([{ 'refresh-cookie': [] }]);
    expect(operation?.responses).toHaveProperty('200');
    expect(operation?.responses).toHaveProperty('401');
    expect(operation?.responses).toHaveProperty('403');
    expect(operation?.responses).toHaveProperty('500');
    expect(operation?.description).toContain('Origin');
    expect(JSON.stringify(operation)).not.toContain(currentRawToken);
  });
});
