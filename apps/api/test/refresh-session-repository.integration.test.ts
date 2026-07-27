import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DuplicateRefreshTokenHashError,
  type RefreshSessionRepository,
} from '../src/auth/application/refresh-session.repository.js';
import type { RefreshTokenHasher } from '../src/auth/application/refresh-token-hasher.js';
import { CryptoRefreshTokenGenerator } from '../src/auth/infrastructure/crypto-refresh-token.generator.js';
import { PrismaRefreshSessionRepository } from '../src/auth/infrastructure/prisma-refresh-session.repository.js';
import { Sha256RefreshTokenHasher } from '../src/auth/infrastructure/sha256-refresh-token.hasher.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { getSafeTestDatabaseUrl } from './safe-test-database-url.js';

describe('PrismaRefreshSessionRepository integration', () => {
  let prisma: PrismaService;
  let repository: RefreshSessionRepository;
  let tokenHasher: RefreshTokenHasher;
  const tokenGenerator = new CryptoRefreshTokenGenerator();

  beforeAll(async () => {
    const databaseUrl = getSafeTestDatabaseUrl(process.env);
    prisma = new PrismaService(new ConfigService({ database: { url: databaseUrl } }));
    await prisma.onModuleInit();
    repository = new PrismaRefreshSessionRepository(prisma);
    tokenHasher = new Sha256RefreshTokenHasher();
  });

  beforeEach(async () => {
    await prisma.refreshSession.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.refreshSession.deleteMany();
    await prisma.user.deleteMany();
    await prisma.onModuleDestroy();
  });

  async function createUser(email = 'session-owner@example.com'): Promise<string> {
    const user = await prisma.user.create({
      data: {
        firstName: 'Meiir',
        lastName: null,
        email,
        passwordHash: '$argon2id$stored-hash',
      },
      select: { id: true },
    });

    return user.id;
  }

  it('persists session expiration and nullable revocation without returning the token hash', async () => {
    const userId = await createUser();
    const rawToken = tokenGenerator.generate();
    const tokenHash = await tokenHasher.hash(rawToken);
    const expiresAt = new Date('2026-08-27T10:15:30.123Z');

    const session = await repository.create({ userId, tokenHash, expiresAt });
    const persisted = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: session.id },
    });

    expect(persisted).toMatchObject({
      userId,
      tokenHash,
      expiresAt,
      revokedAt: null,
    });
    expect(session).toMatchObject({ userId, expiresAt, revokedAt: null });
    expect(session).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(session)).not.toContain(rawToken);
    expect(JSON.stringify(session)).not.toContain(tokenHash);
  });

  it('supports multiple concurrent sessions for one user', async () => {
    const userId = await createUser();
    const expiresAt = new Date('2026-08-27T10:15:30.123Z');
    const firstHash = await tokenHasher.hash(tokenGenerator.generate());
    const secondHash = await tokenHasher.hash(tokenGenerator.generate());

    const [firstSession, secondSession] = await Promise.all([
      repository.create({ userId, tokenHash: firstHash, expiresAt }),
      repository.create({ userId, tokenHash: secondHash, expiresAt }),
    ]);

    expect(firstSession.id).not.toBe(secondSession.id);
    expect(await prisma.refreshSession.count({ where: { userId } })).toBe(2);
  });

  it('finds a session by hash without returning the hash or a raw-token-shaped value', async () => {
    const userId = await createUser();
    const rawToken = tokenGenerator.generate();
    const tokenHash = await tokenHasher.hash(rawToken);
    await repository.create({
      userId,
      tokenHash,
      expiresAt: new Date('2026-08-27T10:15:30.123Z'),
    });

    const session = await repository.findByTokenHash(tokenHash);
    const serialized = JSON.stringify(session);

    expect(session).toMatchObject({ userId, revokedAt: null });
    expect(session).not.toHaveProperty('tokenHash');
    expect(serialized).not.toContain(rawToken);
    expect(serialized).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });

  it('persists session revocation', async () => {
    const userId = await createUser();
    const tokenHash = await tokenHasher.hash(tokenGenerator.generate());
    const session = await repository.create({
      userId,
      tokenHash,
      expiresAt: new Date('2026-08-27T10:15:30.123Z'),
    });
    const revokedAt = new Date('2026-07-28T10:15:30.123Z');

    await repository.revoke(session.id, revokedAt);

    await expect(repository.findByTokenHash(tokenHash)).resolves.toMatchObject({
      id: session.id,
      revokedAt,
    });
  });

  it('deletes a user session when its user is deleted', async () => {
    const userId = await createUser();
    const tokenHash = await tokenHasher.hash(tokenGenerator.generate());
    await repository.create({
      userId,
      tokenHash,
      expiresAt: new Date('2026-08-27T10:15:30.123Z'),
    });

    await prisma.user.delete({ where: { id: userId } });

    await expect(repository.findByTokenHash(tokenHash)).resolves.toBeNull();
    expect(await prisma.refreshSession.count({ where: { userId } })).toBe(0);
  });

  it('maps duplicate token hashes to a controlled repository error', async () => {
    const userId = await createUser();
    const tokenHash = await tokenHasher.hash(tokenGenerator.generate());
    const input = {
      userId,
      tokenHash,
      expiresAt: new Date('2026-08-27T10:15:30.123Z'),
    };
    await repository.create(input);

    await expect(repository.create(input)).rejects.toBeInstanceOf(DuplicateRefreshTokenHashError);
  });
});
