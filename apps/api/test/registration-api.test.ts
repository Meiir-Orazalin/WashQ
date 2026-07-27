import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { registrationResponseSchema, type RegistrationRequest } from '@washqueue/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PasswordHasher } from '../src/auth/application/password-hasher.js';
import { LoginCustomerUseCase } from '../src/auth/application/login-customer.use-case.js';
import { RegisterCustomerUseCase } from '../src/auth/application/register-customer.use-case.js';
import { AuthController } from '../src/auth/presentation/auth.controller.js';
import { RefreshTokenCookiePolicy } from '../src/auth/presentation/refresh-token-cookie.policy.js';
import { HttpExceptionFilter } from '../src/http/http-exception.filter.js';
import { requestIdMiddleware } from '../src/http/request-id.middleware.js';
import { ZodValidationPipe } from '../src/http/zod-validation.pipe.js';
import {
  DuplicateUserEmailError,
  type CreateUser,
  type RegisteredUser,
  type UserRepository,
} from '../src/users/application/user-repository.js';

const validRequest: RegistrationRequest = {
  firstName: 'Meiir',
  lastName: 'Orazalin',
  email: 'meiir@example.com',
  password: 'example-password',
};

describe('POST /api/v1/auth/register', () => {
  let app: INestApplication;
  let failUnexpectedly = false;
  let nextId = 0;
  const users = new Map<string, RegisteredUser>();

  beforeEach(async () => {
    const passwordHasher: PasswordHasher = {
      hash: async () => 'stored-password-hash',
      verify: async () => false,
      verifyDummy: async () => undefined,
    };
    const userRepository: UserRepository = {
      create: async (user: CreateUser) => {
        if (failUnexpectedly) {
          throw new Error('database constraint users_email_key at internal.example');
        }

        if (users.has(user.email)) {
          throw new DuplicateUserEmailError();
        }

        nextId += 1;
        const registeredUser: RegisteredUser = {
          id: `df4e7850-e329-4679-91f1-${String(nextId).padStart(12, '0')}`,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          createdAt: new Date('2026-07-27T12:00:00.000Z'),
        };
        users.set(user.email, registeredUser);
        return registeredUser;
      },
      findAuthenticationByEmail: async () => null,
    };
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: RegisterCustomerUseCase,
          useValue: new RegisterCustomerUseCase(passwordHasher, userRepository),
        },
        {
          provide: LoginCustomerUseCase,
          useValue: { execute: async () => Promise.reject(new Error('not used')) },
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

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(requestIdMiddleware);
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    users.clear();
    failUnexpectedly = false;
    nextId = 0;
  });

  it('returns 201 with a contract-valid public user', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(validRequest)
      .expect(201);

    expect(registrationResponseSchema.parse(response.body)).toEqual(response.body);
    expect(JSON.stringify(response.body)).not.toMatch(/password/i);
    expect(response.body).not.toHaveProperty('accessToken');
    expect(response.body).not.toHaveProperty('refreshToken');
  });

  it('returns 400 for invalid input', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ ...validRequest, firstName: ' ' })
      .expect(400);

    expect(response.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
      },
      path: '/api/v1/auth/register',
    });
  });

  it('normalizes an empty optional last name to null', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ ...validRequest, lastName: '   ' })
      .expect(201);

    expect(response.body.user).toMatchObject({ lastName: null });
  });

  it('returns 409 for a duplicate email', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send(validRequest).expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(validRequest)
      .expect(409);

    expect(response.body).toMatchObject({
      error: {
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'An account with this email already exists',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('users_email_key');
  });

  it('returns 409 for a differently cased duplicate email', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/register').send(validRequest).expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ ...validRequest, email: ' MEIIR@EXAMPLE.COM ' })
      .expect(409);
  });

  it('returns a sanitized 500 for unexpected failures', async () => {
    failUnexpectedly = true;

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(validRequest)
      .expect(500);

    expect(response.body).toMatchObject({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
      path: '/api/v1/auth/register',
    });
    expect(JSON.stringify(response.body)).not.toContain('users_email_key');
    expect(JSON.stringify(response.body)).not.toContain('internal.example');
    expect(response.body).not.toHaveProperty('stack');
  });
});
