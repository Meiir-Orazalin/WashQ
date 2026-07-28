import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AccessTokenService } from '../src/auth/application/access-token.service.js';
import {
  InvalidRefreshSessionError,
  RotateRefreshSessionUseCase,
} from '../src/auth/application/rotate-refresh-session.use-case.js';
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

const now = new Date('2026-07-27T12:00:00.000Z');
const activeExpiry = new Date('2026-08-26T12:00:00.000Z');
const refreshTokenLifetimeSeconds = 2_592_000;

describe('refresh-session rotation integration', () => {
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

  async function createUser(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        firstName: 'Meiir',
        lastName: null,
        email: 'rotation-owner@example.com',
        passwordHash: '$argon2id$stored-hash',
      },
      select: { id: true },
    });

    return user.id;
  }

  async function createSession(
    userId: string,
    rawToken: string,
    expiresAt = activeExpiry,
  ): Promise<RefreshSession> {
    return repository.create({
      userId,
      tokenHash: tokenHasher.hash(rawToken),
      expiresAt,
    });
  }

  function accessTokenService(
    issue: AccessTokenService['issue'] = async ({ subject }) => ({
      token: `signed-access-token-for-${subject}`,
      expiresAt: new Date('2026-07-27T12:15:00.000Z'),
    }),
  ): AccessTokenService {
    return {
      issue,
      verify: async () => {
        throw new Error('verification is not used by refresh rotation tests');
      },
    };
  }

  function rotateUseCase(
    accessTokens: AccessTokenService = accessTokenService(),
  ): RotateRefreshSessionUseCase {
    return new RotateRefreshSessionUseCase(tokenHasher, tokenGenerator, accessTokens, repository, {
      refreshTokenLifetimeSeconds,
      now: () => now,
    });
  }

  it('atomically revokes the old session and links one active replacement in the same family', async () => {
    const userId = await createUser();
    const oldRawToken = tokenGenerator.generate();
    const newRawToken = tokenGenerator.generate();
    const oldSession = await createSession(userId, oldRawToken);

    const result = await repository.rotate({
      sessionId: oldSession.id,
      presentedTokenHash: tokenHasher.hash(oldRawToken),
      expectedUpdatedAt: oldSession.updatedAt,
      replacementTokenHash: tokenHasher.hash(newRawToken),
      replacementExpiresAt: activeExpiry,
      rotatedAt: now,
    });
    const oldPersisted = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: oldSession.id },
    });
    const replacement = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: oldPersisted.replacedBySessionId ?? '' },
    });

    expect(result).toEqual({ status: 'rotated' });
    expect(oldPersisted.revokedAt).toEqual(now);
    expect(oldPersisted.replacedBySessionId).toBe(replacement.id);
    expect(replacement).toMatchObject({
      userId,
      familyId: oldSession.familyId,
      tokenHash: tokenHasher.hash(newRawToken),
      revokedAt: null,
    });
    expect(await prisma.refreshSession.count({ where: { familyId: oldSession.familyId } })).toBe(2);
    expect(
      await prisma.refreshSession.count({
        where: { familyId: oldSession.familyId, revokedAt: null },
      }),
    ).toBe(1);
  });

  it.each([
    {
      name: 'expired',
      expiresAt: now,
      revoke: false,
    },
    {
      name: 'revoked',
      expiresAt: activeExpiry,
      revoke: true,
    },
  ])('does not rotate an $name session', async ({ expiresAt, revoke }) => {
    const userId = await createUser();
    const oldRawToken = tokenGenerator.generate();
    const session = await createSession(userId, oldRawToken, expiresAt);
    if (revoke) {
      await repository.revoke(session.id, now);
    }
    const currentSession = await repository.findByTokenHash(tokenHasher.hash(oldRawToken));
    if (!currentSession) {
      throw new Error('Expected the refresh session fixture to exist');
    }

    const result = await repository.rotate({
      sessionId: session.id,
      presentedTokenHash: tokenHasher.hash(oldRawToken),
      expectedUpdatedAt: currentSession.updatedAt,
      replacementTokenHash: tokenHasher.hash(tokenGenerator.generate()),
      replacementExpiresAt: activeExpiry,
      rotatedAt: now,
    });

    expect(result).toEqual({ status: 'stale' });
    expect(await prisma.refreshSession.count({ where: { familyId: session.familyId } })).toBe(1);
  });

  it('detects replay, revokes only that family, and leaves another login family active', async () => {
    const userId = await createUser();
    const compromisedRawToken = tokenGenerator.generate();
    const unrelatedRawToken = tokenGenerator.generate();
    const compromised = await createSession(userId, compromisedRawToken);
    const unrelated = await createSession(userId, unrelatedRawToken);
    const useCase = rotateUseCase();

    const rotation = await useCase.execute({ rawRefreshToken: compromisedRawToken });
    await expect(useCase.execute({ rawRefreshToken: compromisedRawToken })).rejects.toBeInstanceOf(
      InvalidRefreshSessionError,
    );

    const compromisedFamily = await prisma.refreshSession.findMany({
      where: { familyId: compromised.familyId },
      orderBy: { createdAt: 'asc' },
    });
    const unrelatedPersisted = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: unrelated.id },
    });

    expect(compromisedFamily).toHaveLength(2);
    expect(compromisedFamily.every((session) => session.revokedAt !== null)).toBe(true);
    expect(unrelatedPersisted).toMatchObject({
      familyId: unrelated.familyId,
      revokedAt: null,
      replacedBySessionId: null,
    });
    expect(unrelated.familyId).not.toBe(compromised.familyId);
    expect(JSON.stringify(compromisedFamily)).not.toContain(rotation.rawRefreshToken);
  });

  it('allows no more than one simultaneous rotation and leaves one active replacement', async () => {
    const userId = await createUser();
    const oldRawToken = tokenGenerator.generate();
    const initial = await createSession(userId, oldRawToken);
    let issued = 0;
    let release!: () => void;
    const bothIssuanceAttemptsReached = new Promise<void>((resolve) => {
      release = resolve;
    });
    const accessTokens = accessTokenService(async ({ subject }) => {
      issued += 1;
      if (issued === 2) {
        release();
      }
      await bothIssuanceAttemptsReached;
      return {
        token: `signed-access-token-${issued}-for-${subject}`,
        expiresAt: new Date('2026-07-27T12:15:00.000Z'),
      };
    });
    const useCase = rotateUseCase(accessTokens);

    const attempts = await Promise.allSettled([
      useCase.execute({ rawRefreshToken: oldRawToken }),
      useCase.execute({ rawRefreshToken: oldRawToken }),
    ]);
    const activeFamilySessions = await prisma.refreshSession.findMany({
      where: { familyId: initial.familyId, revokedAt: null },
    });
    const family = await prisma.refreshSession.findMany({
      where: { familyId: initial.familyId },
    });

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const rejected = attempts.find(({ status }) => status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(InvalidRefreshSessionError);
    }
    expect(family).toHaveLength(2);
    expect(activeFamilySessions).toHaveLength(1);
    expect(family.filter(({ replacedBySessionId }) => replacedBySessionId !== null)).toHaveLength(
      1,
    );
  });

  it('stores hashes only and retains user-deletion cascade after rotation', async () => {
    const userId = await createUser();
    const oldRawToken = tokenGenerator.generate();
    await createSession(userId, oldRawToken);
    const result = await rotateUseCase().execute({ rawRefreshToken: oldRawToken });
    const persisted = await prisma.refreshSession.findMany({ where: { userId } });

    expect(persisted).toHaveLength(2);
    expect(persisted.every(({ tokenHash }) => tokenHash.startsWith('sha256:'))).toBe(true);
    expect(JSON.stringify(persisted)).not.toContain(oldRawToken);
    expect(JSON.stringify(persisted)).not.toContain(result.rawRefreshToken);

    await prisma.user.delete({ where: { id: userId } });
    expect(await prisma.refreshSession.count({ where: { userId } })).toBe(0);
  });
});
