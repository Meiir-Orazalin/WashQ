import { createHash, randomBytes } from 'node:crypto';
import { type INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { loginResponseSchema } from '@washqueue/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessTokenService } from '../src/auth/application/access-token.service.js';
import { LoginCustomerUseCase } from '../src/auth/application/login-customer.use-case.js';
import type { PasswordHasher } from '../src/auth/application/password-hasher.js';
import type {
  CreateRefreshSession,
  RefreshSessionRepository,
} from '../src/auth/application/refresh-session.repository.js';
import type { RefreshTokenGenerator } from '../src/auth/application/refresh-token-generator.js';
import type {
  RefreshTokenHash,
  RefreshTokenHasher,
} from '../src/auth/application/refresh-token-hasher.js';
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
import { ZodValidationPipe } from '../src/http/zod-validation.pipe.js';
import type {
  UserAuthenticationRecord,
  UserRepository,
} from '../src/users/application/user-repository.js';

const validRequest = {
  email: 'meiir@example.com',
  password: 'example-password',
};
const user: UserAuthenticationRecord = {
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Meiir',
  lastName: 'Orazalin',
  email: 'meiir@example.com',
  passwordHash: '$argon2id$internal-password-hash',
};
const accessTokenExpiresAt = new Date('2026-07-27T12:15:00.000Z');
const refreshTokenLifetimeSeconds = 2_592_000;
const now = new Date('2026-07-27T12:00:00.000Z');
const signingSecretMarker = 'must-not-appear-signing-secret';

describe('POST /api/v1/auth/login', () => {
  let app: INestApplication;
  let knownUser: UserAuthenticationRecord | null;
  let rawRefreshToken: string;
  let failAccessTokenIssuance: boolean;
  let failSessionPersistence: boolean;
  let failUserLookup: boolean;
  const sessions: CreateRefreshSession[] = [];
  const lookedUpEmails: string[] = [];

  beforeEach(async () => {
    knownUser = user;
    rawRefreshToken = randomBytes(32).toString('base64url');
    failAccessTokenIssuance = false;
    failSessionPersistence = false;
    failUserLookup = false;
    sessions.length = 0;
    lookedUpEmails.length = 0;
    app = await createLoginApp('test');
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  async function createLoginApp(
    nodeEnv: 'development' | 'test' | 'production',
  ): Promise<INestApplication> {
    const userRepository: UserRepository = {
      create: async () => {
        throw new Error('registration is not used by login tests');
      },
      findAuthenticationByEmail: async (email) => {
        lookedUpEmails.push(email);

        if (failUserLookup) {
          throw new Error('database constraint internal_users_email_key');
        }

        return knownUser;
      },
    };
    const passwordHasher: PasswordHasher = {
      hash: async () => {
        throw new Error('password hashing is not used by login tests');
      },
      verify: async (password) => password === validRequest.password,
      verifyDummy: async () => undefined,
    };
    const accessTokenService: AccessTokenService = {
      issue: async () => {
        if (failAccessTokenIssuance) {
          throw new Error(`internal signing detail: ${signingSecretMarker}`);
        }

        return {
          token: 'signed-access-token',
          expiresAt: accessTokenExpiresAt,
        };
      },
      verify: async () => {
        throw new Error('access-token verification is not used by login tests');
      },
    };
    const refreshTokenGenerator: RefreshTokenGenerator = {
      generate: () => rawRefreshToken,
    };
    const refreshTokenHasher: RefreshTokenHasher = {
      hash: (token) =>
        `sha256:${createHash('sha256').update(token).digest('base64url')}` as RefreshTokenHash,
      verify: () => false,
    };
    const refreshSessionRepository: RefreshSessionRepository = {
      create: async (input) => {
        if (failSessionPersistence) {
          throw new Error('database constraint refresh_sessions_token_hash_key');
        }

        sessions.push(input);
        return {
          id: '9bb9aedc-8dc8-409f-86ee-d6be41e71493',
          userId: input.userId,
          familyId: '8ca97bb3-06dc-4f9a-ab8b-fbf4244ae415',
          expiresAt: input.expiresAt,
          revokedAt: null,
          replacedBySessionId: null,
          createdAt: now,
          updatedAt: now,
        };
      },
      findByTokenHash: async () => null,
      revoke: async () => undefined,
      revokeFamily: async () => undefined,
      rotate: async () => ({ status: 'stale' }),
    };
    const loginCustomer = new LoginCustomerUseCase(
      userRepository,
      passwordHasher,
      accessTokenService,
      refreshTokenGenerator,
      refreshTokenHasher,
      refreshSessionRepository,
      { refreshTokenLifetimeSeconds, now: () => now },
    );
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: RegisterCustomerUseCase, useValue: { execute: () => Promise.reject() } },
        { provide: LoginCustomerUseCase, useValue: loginCustomer },
        {
          provide: RotateRefreshSessionUseCase,
          useValue: { execute: async () => Promise.reject(new Error('not used')) },
        },
        {
          provide: RefreshRequestOriginPolicy,
          useValue: new RefreshRequestOriginPolicy(['http://localhost:3000']),
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
    testApp.setGlobalPrefix('api/v1');
    testApp.use(requestIdMiddleware);
    testApp.useGlobalPipes(new ZodValidationPipe());
    testApp.useGlobalFilters(new HttpExceptionFilter());
    await testApp.init();
    return testApp;
  }

  it('returns HTTP 200 with a contract-valid access-token response', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(validRequest)
      .expect(200);

    expect(loginResponseSchema.parse(response.body)).toEqual(response.body);
    expect(response.body).toMatchObject({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
      accessToken: 'signed-access-token',
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
    });
    expect(response.body).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(response.body)).not.toMatch(/password|tokenHash|sessionId/i);
  });

  it('sets the refresh token only in an HttpOnly same-site scoped cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(validRequest)
      .expect(200);
    const cookie = getRefreshCookie(response.headers['set-cookie']);

    expect(cookie).toContain(`${refreshTokenCookieName}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain(`Max-Age=${refreshTokenLifetimeSeconds}`);
    expect(cookie).not.toContain('Secure');
    expect(cookie).not.toContain('Domain=');
    expect(cookie).toContain(encodeURIComponent(rawRefreshToken));
  });

  it('sets Secure on the refresh cookie in production', async () => {
    await app.close();
    app = await createLoginApp('production');

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(validRequest)
      .expect(200);

    expect(getRefreshCookie(response.headers['set-cookie'])).toContain('Secure');
  });

  it('returns 400 for invalid input without setting a cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: validRequest.email })
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
    });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('returns identical generic 401 errors for unknown email and wrong password', async () => {
    knownUser = null;
    const unknownEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(validRequest)
      .expect(401);
    knownUser = user;
    const wrongPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ ...validRequest, password: 'wrong-password' })
      .expect(401);

    expect(unknownEmail.body.error).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    expect(wrongPassword.body.error).toEqual(unknownEmail.body.error);
    expect(unknownEmail.headers['set-cookie']).toBeUndefined();
    expect(wrongPassword.headers['set-cookie']).toBeUndefined();
  });

  it('normalizes uppercase and surrounding email whitespace', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ ...validRequest, email: ' MEIIR@EXAMPLE.COM ' })
      .expect(200);

    expect(lookedUpEmails).toEqual(['meiir@example.com']);
  });

  it('returns a sanitized 500 and no cookie for an unexpected failure', async () => {
    failUserLookup = true;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(validRequest)
      .expect(500);

    expect(response.body.error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/constraint|database|stack/i);
  });

  it('does not set a cookie when access-token issuance fails', async () => {
    failAccessTokenIssuance = true;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(validRequest)
      .expect(500);

    expect(response.headers['set-cookie']).toBeUndefined();
    expect(sessions).toHaveLength(0);
  });

  it('does not set a cookie or return tokens when session persistence fails', async () => {
    failSessionPersistence = true;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(validRequest)
      .expect(500);

    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body).not.toHaveProperty('accessToken');
    expect(JSON.stringify(response.body)).not.toContain(rawRefreshToken);
  });

  it('does not log the password, refresh token, or a signing-secret value', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error');
    failSessionPersistence = true;

    await request(app.getHttpServer()).post('/api/v1/auth/login').send(validRequest).expect(500);

    failSessionPersistence = false;
    failAccessTokenIssuance = true;
    await request(app.getHttpServer()).post('/api/v1/auth/login').send(validRequest).expect(500);

    const serializedLogs = JSON.stringify(errorLog.mock.calls);
    expect(serializedLogs).not.toContain(validRequest.password);
    expect(serializedLogs).not.toContain(rawRefreshToken);
    expect(serializedLogs).not.toContain(signingSecretMarker);
  });

  it('documents login request, success, and expected error responses in OpenAPI', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Test API').setVersion('1').build(),
    );
    const operation = document.paths['/api/v1/auth/login']?.post;

    expect(operation?.requestBody).toBeDefined();
    expect(operation?.responses).toMatchObject({
      '200': expect.any(Object),
      '400': expect.any(Object),
      '401': expect.any(Object),
      '500': expect.any(Object),
    });
    expect(operation?.description).toContain('HttpOnly refresh-session cookie');
  });
});

function getRefreshCookie(value: string | string[] | undefined): string {
  const cookies = typeof value === 'string' ? [value] : value;
  const cookie = cookies?.find((candidate) => candidate.startsWith(`${refreshTokenCookieName}=`));

  if (!cookie) {
    throw new Error('Refresh cookie was not set');
  }

  return cookie;
}
