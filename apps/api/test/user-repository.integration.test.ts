import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PasswordHasher } from '../src/auth/application/password-hasher.js';
import { GetCurrentUserUseCase } from '../src/auth/application/get-current-user.use-case.js';
import { LoginCustomerUseCase } from '../src/auth/application/login-customer.use-case.js';
import { LogoutCurrentSessionUseCase } from '../src/auth/application/logout-current-session.use-case.js';
import { RegisterCustomerUseCase } from '../src/auth/application/register-customer.use-case.js';
import { RotateRefreshSessionUseCase } from '../src/auth/application/rotate-refresh-session.use-case.js';
import { AuthController } from '../src/auth/presentation/auth.controller.js';
import { RefreshRequestOriginPolicy } from '../src/auth/presentation/refresh-request-origin.policy.js';
import { RefreshTokenCookiePolicy } from '../src/auth/presentation/refresh-token-cookie.policy.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { HttpExceptionFilter } from '../src/http/http-exception.filter.js';
import { requestIdMiddleware } from '../src/http/request-id.middleware.js';
import { ZodValidationPipe } from '../src/http/zod-validation.pipe.js';
import { DuplicateUserEmailError } from '../src/users/application/user-repository.js';
import { PrismaUserRepository } from '../src/users/infrastructure/prisma-user.repository.js';
import { getSafeTestDatabaseUrl } from './safe-test-database-url.js';

describe('PrismaUserRepository integration', () => {
  let prisma: PrismaService;
  let repository: PrismaUserRepository;

  beforeAll(async () => {
    const databaseUrl = getSafeTestDatabaseUrl(process.env);
    prisma = new PrismaService(new ConfigService({ database: { url: databaseUrl } }));
    await prisma.onModuleInit();
    repository = new PrismaUserRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.onModuleDestroy();
  });

  it('persists a user and returns only public registration fields', async () => {
    const user = await repository.create({
      firstName: 'Meiir',
      lastName: 'Orazalin',
      email: 'meiir@example.com',
      passwordHash: '$argon2id$stored-hash',
    });

    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });

    expect(persisted).toMatchObject({
      firstName: 'Meiir',
      lastName: 'Orazalin',
      email: 'meiir@example.com',
      passwordHash: '$argon2id$stored-hash',
    });
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('persists email in lowercase', async () => {
    const user = await repository.create({
      firstName: 'Meiir',
      lastName: null,
      email: 'MEIIR@EXAMPLE.COM',
      passwordHash: '$argon2id$stored-hash',
    });

    expect(user.email).toBe('meiir@example.com');
  });

  it('persists a nullable last name', async () => {
    const user = await repository.create({
      firstName: 'Meiir',
      lastName: null,
      email: 'meiir@example.com',
      passwordHash: '$argon2id$stored-hash',
    });

    expect(user.lastName).toBeNull();
  });

  it('returns the minimum authentication record for a normalized email lookup', async () => {
    await repository.create({
      firstName: 'Meiir',
      lastName: 'Orazalin',
      email: 'meiir@example.com',
      passwordHash: '$argon2id$stored-hash',
    });

    await expect(repository.findAuthenticationByEmail('meiir@example.com')).resolves.toMatchObject({
      firstName: 'Meiir',
      lastName: 'Orazalin',
      email: 'meiir@example.com',
      passwordHash: '$argon2id$stored-hash',
    });
  });

  it('returns null for an unknown authentication email', async () => {
    await expect(repository.findAuthenticationByEmail('unknown@example.com')).resolves.toBeNull();
  });

  it('finds a current public user by ID with the correct projection', async () => {
    const created = await repository.create({
      firstName: 'Current',
      lastName: 'Customer',
      email: 'current@example.com',
      passwordHash: '$argon2id$must-remain-internal',
    });

    const user = await repository.findPublicById(created.id);

    expect(user).toEqual({
      id: created.id,
      firstName: 'Current',
      lastName: 'Customer',
      email: 'current@example.com',
    });
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('returns a nullable last name in the public projection', async () => {
    const created = await repository.create({
      firstName: 'Current',
      lastName: null,
      email: 'nullable@example.com',
      passwordHash: '$argon2id$must-remain-internal',
    });

    await expect(repository.findPublicById(created.id)).resolves.toMatchObject({
      lastName: null,
    });
  });

  it('returns null for an unknown public user ID', async () => {
    await expect(
      repository.findPublicById('df4e7850-e329-4679-91f1-77b409d93f4f'),
    ).resolves.toBeNull();
  });

  it('returns null after the referenced user is deleted', async () => {
    const created = await repository.create({
      firstName: 'Deleted',
      lastName: null,
      email: 'deleted@example.com',
      passwordHash: '$argon2id$must-remain-internal',
    });
    await prisma.user.delete({ where: { id: created.id } });

    await expect(repository.findPublicById(created.id)).resolves.toBeNull();
  });

  it('maps the unique email constraint to a controlled error', async () => {
    const user = {
      firstName: 'Meiir',
      lastName: null,
      email: 'meiir@example.com',
      passwordHash: '$argon2id$stored-hash',
    };

    await repository.create(user);

    await expect(repository.create(user)).rejects.toBeInstanceOf(DuplicateUserEmailError);
  });

  it('allows exactly one concurrent registration for one normalized email', async () => {
    const passwordHasher: PasswordHasher = {
      hash: async () => '$argon2id$stored-hash',
      verify: async () => false,
      verifyDummy: async () => undefined,
    };
    const registerCustomer = new RegisterCustomerUseCase(passwordHasher, repository);
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: RegisterCustomerUseCase, useValue: registerCustomer },
        {
          provide: LoginCustomerUseCase,
          useValue: { execute: async () => Promise.reject(new Error('not used')) },
        },
        {
          provide: GetCurrentUserUseCase,
          useValue: { execute: async () => Promise.reject(new Error('not used')) },
        },
        {
          provide: RotateRefreshSessionUseCase,
          useValue: { execute: async () => Promise.reject(new Error('not used')) },
        },
        {
          provide: LogoutCurrentSessionUseCase,
          useValue: { execute: async () => Promise.reject(new Error('not used')) },
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
    const app: INestApplication = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(requestIdMiddleware);
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    try {
      const baseRequest = {
        firstName: 'Meiir',
        email: 'race@example.com',
        password: 'example-password',
      };
      const responses = await Promise.all([
        request(app.getHttpServer()).post('/api/v1/auth/register').send(baseRequest),
        request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({ ...baseRequest, email: ' RACE@EXAMPLE.COM ' }),
      ]);

      expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
      expect(responses.find(({ status }) => status === 409)?.body).toMatchObject({
        error: { code: 'EMAIL_ALREADY_REGISTERED' },
      });
      expect(await prisma.user.count({ where: { email: 'race@example.com' } })).toBe(1);
    } finally {
      await app.close();
    }
  });
});
