import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LogoutCurrentSessionUseCase } from '../src/auth/application/logout-current-session.use-case.js';
import type {
  RefreshSession,
  RefreshSessionRepository,
} from '../src/auth/application/refresh-session.repository.js';
import type { RefreshTokenHasher } from '../src/auth/application/refresh-token-hasher.js';
import { CryptoRefreshTokenGenerator } from '../src/auth/infrastructure/crypto-refresh-token.generator.js';
import { PrismaRefreshSessionRepository } from '../src/auth/infrastructure/prisma-refresh-session.repository.js';
import { Sha256RefreshTokenHasher } from '../src/auth/infrastructure/sha256-refresh-token.hasher.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { getSafeTestDatabaseUrl } from './safe-test-database-url.js';

const logoutAt = new Date('2026-07-28T12:00:00.000Z');
const activeExpiry = new Date('2026-08-28T12:00:00.000Z');
const expiredAt = new Date('2026-07-28T11:59:59.000Z');

describe('current refresh-session logout integration', () => {
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

  async function createUser(email = 'logout-owner@example.com'): Promise<string> {
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

  async function createSession(
    userId: string,
    expiresAt = activeExpiry,
  ): Promise<{ rawToken: string; session: RefreshSession }> {
    const rawToken = tokenGenerator.generate();
    const session = await repository.create({
      userId,
      tokenHash: tokenHasher.hash(rawToken),
      expiresAt,
    });

    return { rawToken, session };
  }

  function logoutUseCase(now: () => Date = () => logoutAt): LogoutCurrentSessionUseCase {
    return new LogoutCurrentSessionUseCase(tokenHasher, repository, { now });
  }

  it('revokes only the active session matching the presented token hash', async () => {
    const userId = await createUser();
    const target = await createSession(userId);
    const sameUserOtherSession = await createSession(userId);
    const otherUserId = await createUser('other-owner@example.com');
    const otherFamilySession = await createSession(otherUserId);

    await logoutUseCase().execute({ rawRefreshToken: target.rawToken });

    const [targetPersisted, sameUserPersisted, otherFamilyPersisted] = await Promise.all([
      prisma.refreshSession.findUniqueOrThrow({ where: { id: target.session.id } }),
      prisma.refreshSession.findUniqueOrThrow({ where: { id: sameUserOtherSession.session.id } }),
      prisma.refreshSession.findUniqueOrThrow({ where: { id: otherFamilySession.session.id } }),
    ]);
    expect(targetPersisted.revokedAt).toEqual(logoutAt);
    expect(sameUserPersisted.revokedAt).toBeNull();
    expect(otherFamilyPersisted.revokedAt).toBeNull();
    expect(target.session.familyId).not.toBe(sameUserOtherSession.session.familyId);
  });

  it('leaves already-revoked, expired, and unknown sessions safely unchanged', async () => {
    const userId = await createUser();
    const alreadyRevoked = await createSession(userId);
    const expired = await createSession(userId, expiredAt);
    const unrelated = await createSession(userId);
    const originalRevocation = new Date('2026-07-28T10:00:00.000Z');
    await repository.revoke(alreadyRevoked.session.id, originalRevocation);

    const useCase = logoutUseCase();
    await expect(
      useCase.execute({ rawRefreshToken: alreadyRevoked.rawToken }),
    ).resolves.toBeUndefined();
    await expect(useCase.execute({ rawRefreshToken: expired.rawToken })).resolves.toBeUndefined();
    await expect(
      useCase.execute({ rawRefreshToken: tokenGenerator.generate() }),
    ).resolves.toBeUndefined();

    const persisted = await prisma.refreshSession.findMany({ where: { userId } });
    expect(persisted).toHaveLength(3);
    expect(persisted.find(({ id }) => id === alreadyRevoked.session.id)?.revokedAt).toEqual(
      originalRevocation,
    );
    expect(persisted.find(({ id }) => id === expired.session.id)?.revokedAt).toBeNull();
    expect(persisted.find(({ id }) => id === unrelated.session.id)?.revokedAt).toBeNull();
  });

  it('does not treat logout of a rotated predecessor as replay or revoke its replacement', async () => {
    const userId = await createUser();
    const predecessor = await createSession(userId);
    const independent = await createSession(userId);
    const replacementRawToken = tokenGenerator.generate();
    const rotatedAt = new Date('2026-07-28T11:00:00.000Z');

    await expect(
      repository.rotate({
        sessionId: predecessor.session.id,
        presentedTokenHash: tokenHasher.hash(predecessor.rawToken),
        expectedUpdatedAt: predecessor.session.updatedAt,
        replacementTokenHash: tokenHasher.hash(replacementRawToken),
        replacementExpiresAt: activeExpiry,
        rotatedAt,
      }),
    ).resolves.toEqual({ status: 'rotated' });

    await logoutUseCase().execute({ rawRefreshToken: predecessor.rawToken });

    const predecessorPersisted = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: predecessor.session.id },
    });
    const replacementPersisted = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: predecessorPersisted.replacedBySessionId ?? '' },
    });
    const independentPersisted = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: independent.session.id },
    });
    expect(predecessorPersisted.revokedAt).toEqual(rotatedAt);
    expect(replacementPersisted.revokedAt).toBeNull();
    expect(replacementPersisted.familyId).toBe(predecessor.session.familyId);
    expect(independentPersisted.revokedAt).toBeNull();
  });

  it('persists only the hash and retains user-deletion cascade after logout', async () => {
    const userId = await createUser();
    const target = await createSession(userId);

    await logoutUseCase().execute({ rawRefreshToken: target.rawToken });

    const persisted = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: target.session.id },
    });
    expect(persisted.tokenHash).toBe(tokenHasher.hash(target.rawToken));
    expect(persisted.tokenHash).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(persisted)).not.toContain(target.rawToken);

    await prisma.user.delete({ where: { id: userId } });
    expect(await prisma.refreshSession.count({ where: { userId } })).toBe(0);
  });

  it('handles two simultaneous logout attempts without modifying unrelated sessions', async () => {
    const userId = await createUser();
    const target = await createSession(userId);
    const unrelated = await createSession(userId);
    const firstRevocation = new Date('2026-07-28T12:00:00.001Z');
    const secondRevocation = new Date('2026-07-28T12:00:00.002Z');
    const firstLogout = logoutUseCase(() => firstRevocation);
    const secondLogout = logoutUseCase(() => secondRevocation);

    const attempts = await Promise.allSettled([
      firstLogout.execute({ rawRefreshToken: target.rawToken }),
      secondLogout.execute({ rawRefreshToken: target.rawToken }),
    ]);

    const targetPersisted = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: target.session.id },
    });
    const unrelatedPersisted = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: unrelated.session.id },
    });
    expect(attempts.map(({ status }) => status)).toEqual(['fulfilled', 'fulfilled']);
    expect([firstRevocation.getTime(), secondRevocation.getTime()]).toContain(
      targetPersisted.revokedAt?.getTime(),
    );
    expect(unrelatedPersisted.revokedAt).toBeNull();
    expect(await prisma.refreshSession.count({ where: { userId } })).toBe(2);
  });
});
