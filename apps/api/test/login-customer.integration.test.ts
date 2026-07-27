import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccessTokenService } from '../src/auth/application/access-token.service.js';
import {
  InvalidCredentialsError,
  LoginCustomerUseCase,
} from '../src/auth/application/login-customer.use-case.js';
import { Argon2PasswordHasher } from '../src/auth/infrastructure/argon2-password.hasher.js';
import { CryptoRefreshTokenGenerator } from '../src/auth/infrastructure/crypto-refresh-token.generator.js';
import { PrismaRefreshSessionRepository } from '../src/auth/infrastructure/prisma-refresh-session.repository.js';
import { Sha256RefreshTokenHasher } from '../src/auth/infrastructure/sha256-refresh-token.hasher.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PrismaUserRepository } from '../src/users/infrastructure/prisma-user.repository.js';
import { getSafeTestDatabaseUrl } from './safe-test-database-url.js';

const now = new Date('2026-07-27T12:00:00.000Z');
const refreshTokenLifetimeSeconds = 2_592_000;

describe('LoginCustomerUseCase persistence integration', () => {
  let prisma: PrismaService;
  let userRepository: PrismaUserRepository;
  let passwordHasher: Argon2PasswordHasher;
  let loginCustomer: LoginCustomerUseCase;

  beforeAll(async () => {
    const databaseUrl = getSafeTestDatabaseUrl(process.env);
    prisma = new PrismaService(new ConfigService({ database: { url: databaseUrl } }));
    await prisma.onModuleInit();
    userRepository = new PrismaUserRepository(prisma);
    passwordHasher = new Argon2PasswordHasher();
    const accessTokenService: AccessTokenService = {
      issue: async ({ subject }) => ({
        token: `signed-access-token-for-${subject}`,
        expiresAt: new Date('2026-07-27T12:15:00.000Z'),
      }),
      verify: async () => {
        throw new Error('verification is not used by login integration tests');
      },
    };
    loginCustomer = new LoginCustomerUseCase(
      userRepository,
      passwordHasher,
      accessTokenService,
      new CryptoRefreshTokenGenerator(),
      new Sha256RefreshTokenHasher(),
      new PrismaRefreshSessionRepository(prisma),
      { refreshTokenLifetimeSeconds, now: () => now },
    );
  });

  beforeEach(async () => {
    await prisma.refreshSession.deleteMany();
    await prisma.user.deleteMany();
    await createLoginUser();
  });

  afterAll(async () => {
    await prisma.refreshSession.deleteMany();
    await prisma.user.deleteMany();
    await prisma.onModuleDestroy();
  });

  async function createLoginUser(): Promise<void> {
    await userRepository.create({
      firstName: 'Meiir',
      lastName: 'Orazalin',
      email: 'meiir@example.com',
      passwordHash: await passwordHasher.hash('example-password'),
    });
  }

  it('creates a non-revoked session containing only the refresh-token hash', async () => {
    const result = await loginCustomer.execute({
      email: ' MEIIR@EXAMPLE.COM ',
      password: 'example-password',
    });
    const persisted = await prisma.refreshSession.findFirstOrThrow({
      where: { userId: result.user.id },
    });

    expect(persisted).toMatchObject({
      userId: result.user.id,
      expiresAt: new Date('2026-08-26T12:00:00.000Z'),
      revokedAt: null,
    });
    expect(persisted.tokenHash).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/);
    expect(persisted.tokenHash).not.toBe(result.rawRefreshToken);
    expect(JSON.stringify(persisted)).not.toContain(result.rawRefreshToken);
  });

  it('creates multiple independent sessions for repeated logins', async () => {
    const first = await loginCustomer.execute({
      email: 'meiir@example.com',
      password: 'example-password',
    });
    const second = await loginCustomer.execute({
      email: 'meiir@example.com',
      password: 'example-password',
    });

    expect(first.rawRefreshToken).not.toBe(second.rawRefreshToken);
    expect(await prisma.refreshSession.count({ where: { userId: first.user.id } })).toBe(2);
  });

  it('does not create a session for invalid credentials', async () => {
    await expect(
      loginCustomer.execute({
        email: 'meiir@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(await prisma.refreshSession.count()).toBe(0);
  });

  it('retains cascading session deletion after a successful login', async () => {
    const result = await loginCustomer.execute({
      email: 'meiir@example.com',
      password: 'example-password',
    });

    await prisma.user.delete({ where: { id: result.user.id } });

    expect(await prisma.refreshSession.count({ where: { userId: result.user.id } })).toBe(0);
  });
});
