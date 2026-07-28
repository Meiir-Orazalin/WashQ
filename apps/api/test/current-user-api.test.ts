import { type INestApplication, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { currentUserResponseSchema } from '@washqueue/contracts';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GetCurrentUserUseCase } from '../src/auth/application/get-current-user.use-case.js';
import { LoginCustomerUseCase } from '../src/auth/application/login-customer.use-case.js';
import { LogoutCurrentSessionUseCase } from '../src/auth/application/logout-current-session.use-case.js';
import { RegisterCustomerUseCase } from '../src/auth/application/register-customer.use-case.js';
import { RotateRefreshSessionUseCase } from '../src/auth/application/rotate-refresh-session.use-case.js';
import { JoseAccessTokenService } from '../src/auth/infrastructure/jose-access-token.service.js';
import { AuthController } from '../src/auth/presentation/auth.controller.js';
import { RefreshRequestOriginPolicy } from '../src/auth/presentation/refresh-request-origin.policy.js';
import {
  RefreshTokenCookiePolicy,
  refreshTokenCookieName,
} from '../src/auth/presentation/refresh-token-cookie.policy.js';
import { HttpExceptionFilter } from '../src/http/http-exception.filter.js';
import { requestIdMiddleware } from '../src/http/request-id.middleware.js';
import type { PublicUser, UserRepository } from '../src/users/application/user-repository.js';

const subject = 'df4e7850-e329-4679-91f1-77b409d93f4f';
const initialTime = new Date('2026-07-28T10:00:00.000Z');
const signingSecret = 's'.repeat(48);
const signingSecretMarker = 'must-not-appear-signing-secret';
const publicUser: PublicUser = {
  id: subject,
  firstName: 'Meiir',
  lastName: 'Orazalin',
  email: 'meiir@example.com',
};
const authenticationError = {
  code: 'AUTHENTICATION_REQUIRED',
  message: 'Authentication is required',
};

describe('GET /api/v1/auth/me', () => {
  let app: INestApplication;
  let now: Date;
  let currentUser: PublicUser | null;
  let failUserLookup: boolean;
  let accessTokenService: JoseAccessTokenService;
  let validAccessToken = '';
  const lookedUpUserIds: string[] = [];

  beforeEach(async () => {
    now = initialTime;
    currentUser = publicUser;
    failUserLookup = false;
    lookedUpUserIds.length = 0;
    accessTokenService = new JoseAccessTokenService({
      signingSecret,
      lifetimeSeconds: 900,
      now: () => now,
    });
    validAccessToken = (await accessTokenService.issue({ subject })).token;
    app = await createCurrentUserApp();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  async function createCurrentUserApp(): Promise<INestApplication> {
    const userRepository: UserRepository = {
      create: async () => {
        throw new Error('registration is not used by current-user tests');
      },
      findAuthenticationByEmail: async () => null,
      findPublicById: async (id) => {
        lookedUpUserIds.push(id);
        if (failUserLookup) {
          throw new Error(`database lookup failed using ${signingSecretMarker}`);
        }
        return currentUser;
      },
    };
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: GetCurrentUserUseCase,
          useValue: new GetCurrentUserUseCase(accessTokenService, userRepository),
        },
        {
          provide: RegisterCustomerUseCase,
          useValue: { execute: () => Promise.reject(new Error('not used')) },
        },
        {
          provide: LoginCustomerUseCase,
          useValue: { execute: () => Promise.reject(new Error('not used')) },
        },
        {
          provide: RotateRefreshSessionUseCase,
          useValue: { execute: () => Promise.reject(new Error('not used')) },
        },
        {
          provide: LogoutCurrentSessionUseCase,
          useValue: { execute: () => Promise.reject(new Error('not used')) },
        },
        {
          provide: RefreshRequestOriginPolicy,
          useValue: new RefreshRequestOriginPolicy(['http://localhost:3000']),
        },
        {
          provide: RefreshTokenCookiePolicy,
          useValue: new RefreshTokenCookiePolicy({
            nodeEnv: 'test',
            refreshTokenLifetimeSeconds: 2_592_000,
          }),
        },
      ],
    }).compile();
    const testApp = module.createNestApplication();
    testApp.setGlobalPrefix('api/v1');
    testApp.use(requestIdMiddleware);
    testApp.useGlobalFilters(new HttpExceptionFilter());
    await testApp.init();
    return testApp;
  }

  function getCurrentUser(authorization = `Bearer ${validAccessToken}`) {
    return request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', authorization);
  }

  it('returns HTTP 200 with a contract-valid current public user', async () => {
    const response = await getCurrentUser().expect(200);

    expect(currentUserResponseSchema.parse(response.body)).toEqual(response.body);
    expect(response.body).toEqual({ user: publicUser });
    expect(lookedUpUserIds).toEqual([subject]);
  });

  it('uses current database values rather than access-token profile data', async () => {
    currentUser = {
      ...publicUser,
      firstName: 'Updated',
      lastName: null,
      email: 'updated@example.com',
    };

    const response = await getCurrentUser().expect(200);

    expect(response.body.user).toEqual(currentUser);
  });

  it('works without a refresh cookie and never sets a cookie', async () => {
    const response = await getCurrentUser().expect(200);

    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('does not accept the refresh cookie as authentication', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', `${refreshTokenCookieName}=opaque-refresh-token`)
      .expect(401);

    expect(response.body.error).toEqual(authenticationError);
    expect(lookedUpUserIds).toHaveLength(0);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    { state: 'missing Authorization', authorization: undefined },
    { state: 'an unsupported scheme', authorization: `Basic ${validAccessToken}` },
    { state: 'a malformed token', authorization: 'Bearer not-a-jwt' },
  ])('returns the generic 401 for $state', async ({ authorization }) => {
    let pendingRequest = request(app.getHttpServer()).get('/api/v1/auth/me');
    if (authorization) {
      pendingRequest = pendingRequest.set('Authorization', authorization);
    }

    const response = await pendingRequest.expect(401);

    expect(response.body.error).toEqual(authenticationError);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('returns the same generic 401 for an expired token', async () => {
    now = new Date('2026-07-28T10:15:01.000Z');

    const response = await getCurrentUser().expect(401);

    expect(response.body.error).toEqual(authenticationError);
  });

  it('returns the same generic 401 for an invalid signature', async () => {
    const otherService = new JoseAccessTokenService({
      signingSecret: 'x'.repeat(48),
      lifetimeSeconds: 900,
      now: () => now,
    });
    const invalidToken = (await otherService.issue({ subject })).token;

    const response = await getCurrentUser(`Bearer ${invalidToken}`).expect(401);

    expect(response.body.error).toEqual(authenticationError);
  });

  it('returns the same generic 401 for the wrong token type', async () => {
    const issuedAt = Math.floor(now.getTime() / 1_000);
    const wrongTypeToken = await new SignJWT({ tokenType: 'refresh' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(subject)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 900)
      .sign(new TextEncoder().encode(signingSecret));

    const response = await getCurrentUser(`Bearer ${wrongTypeToken}`).expect(401);

    expect(response.body.error).toEqual(authenticationError);
  });

  it('returns the same generic 401 for an invalid subject', async () => {
    const invalidSubjectToken = (await accessTokenService.issue({ subject: 'not-a-uuid' })).token;

    const response = await getCurrentUser(`Bearer ${invalidSubjectToken}`).expect(401);

    expect(response.body.error).toEqual(authenticationError);
    expect(lookedUpUserIds).toHaveLength(0);
  });

  it('returns the same generic 401 when the referenced user was deleted', async () => {
    currentUser = null;

    const response = await getCurrentUser().expect(401);

    expect(response.body.error).toEqual(authenticationError);
  });

  it('returns a sanitized 500 without a cookie for an unexpected lookup failure', async () => {
    failUserLookup = true;

    const response = await getCurrentUser().expect(500);

    expect(response.body.error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/database|signing|constraint|stack/i);
  });

  it('does not log the Authorization token or signing secret on failure', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error');
    failUserLookup = true;

    await getCurrentUser().expect(500);

    const logs = JSON.stringify(errorLog.mock.calls);
    expect(logs).not.toContain(validAccessToken);
    expect(logs).not.toContain(signingSecret);
    expect(logs).not.toContain(signingSecretMarker);
  });

  it('returns only public user fields', async () => {
    const response = await getCurrentUser().expect(200);
    const serialized = JSON.stringify(response.body);

    expect(Object.keys(response.body.user).sort()).toEqual([
      'email',
      'firstName',
      'id',
      'lastName',
    ]);
    expect(serialized).not.toMatch(
      /password|accessToken|refreshToken|session|claim|role|permission|organization|vehicle/i,
    );
  });

  it('documents Bearer authentication only on the current-user endpoint', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
        .addCookieAuth(refreshTokenCookieName, { type: 'apiKey', in: 'cookie' }, 'refresh-cookie')
        .build(),
    );
    const currentUserOperation = document.paths['/api/v1/auth/me']?.get;

    expect(currentUserOperation?.security).toEqual([{ 'access-token': [] }]);
    expect(currentUserOperation?.requestBody).toBeUndefined();
    expect(currentUserOperation?.responses).toHaveProperty('200');
    expect(currentUserOperation?.responses).toHaveProperty('401');
    expect(currentUserOperation?.responses).toHaveProperty('500');
    expect(currentUserOperation?.description).toContain(
      'current public user values from PostgreSQL',
    );
    expect(document.paths['/api/v1/auth/register']?.post?.security).toBeUndefined();
    expect(document.paths['/api/v1/auth/login']?.post?.security).toBeUndefined();
    expect(document.paths['/api/v1/auth/refresh']?.post?.security).toEqual([
      { 'refresh-cookie': [] },
    ]);
    expect(document.paths['/api/v1/auth/logout']?.post?.security).toEqual([
      { 'refresh-cookie': [] },
    ]);
    expect(JSON.stringify(currentUserOperation)).not.toContain(validAccessToken);
  });
});
