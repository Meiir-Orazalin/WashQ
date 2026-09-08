import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { PrismaUserRepository } from '../src/users/infrastructure/prisma-user.repository.js';
import { getSafeTestDatabaseUrl } from './safe-test-database-url.js';

describe('PrismaUserRepository profile integration', () => {
  let prisma: PrismaService;
  let repository: PrismaUserRepository;
  let userId: string;
  let otherId: string;
  const initialTime = new Date('2026-01-01T00:00:00Z');
  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: getSafeTestDatabaseUrl(process.env) } }),
    );
    await prisma.onModuleInit();
    repository = new PrismaUserRepository(prisma);
  });
  beforeEach(async () => {
    userId = randomUUID();
    otherId = randomUUID();
    await prisma.user.createMany({
      data: [userId, otherId].map((id) => ({
        id,
        firstName: 'Initial',
        lastName: 'Surname',
        email: `profile-${id}@integration.invalid`,
        passwordHash: 'test-only-stored-hash',
        createdAt: initialTime,
        updatedAt: initialTime,
      })),
    });
    await prisma.vehicle.create({
      data: { ownerUserId: userId, make: 'Toyota', model: 'Camry', plateNumber: '123ABC01' },
    });
    await prisma.refreshSession.create({
      data: { userId, tokenHash: 'a'.repeat(64), expiresAt: new Date('2030-01-01T00:00:00Z') },
    });
  });
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    expect(await prisma.user.count({ where: { id: { in: [userId, otherId] } } })).toBe(0);
    expect(await prisma.vehicle.count({ where: { ownerUserId: userId } })).toBe(0);
    expect(await prisma.refreshSession.count({ where: { userId } })).toBe(0);
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it.each([
    { firstName: 'Updated' },
    { lastName: 'Updated' },
    { lastName: null },
    { firstName: 'Updated', lastName: null },
  ])('updates only supplied names, timestamps and narrow projection %#', async (patch) => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const other = await prisma.user.findUniqueOrThrow({ where: { id: otherId } });
    const vehicles = await prisma.vehicle.findMany({ where: { ownerUserId: userId } });
    const sessions = await prisma.refreshSession.findMany({ where: { userId } });
    const result = await repository.updateCurrentUserProfile(userId, patch);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(result).toEqual({
      id: userId,
      firstName: patch.firstName ?? before.firstName,
      lastName: patch.lastName === undefined ? before.lastName : patch.lastName,
      email: before.email,
    });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.email === before.email && after.passwordHash === before.passwordHash).toBe(true);
    expect(
      JSON.stringify(await prisma.user.findUniqueOrThrow({ where: { id: otherId } })) ===
        JSON.stringify(other),
    ).toBe(true);
    expect(await prisma.vehicle.findMany({ where: { ownerUserId: userId } })).toEqual(vehicles);
    expect(
      JSON.stringify(await prisma.refreshSession.findMany({ where: { userId } })) ===
        JSON.stringify(sessions),
    ).toBe(true);
  });
  it('returns null atomically after user deletion, without recreation', async () => {
    await prisma.user.delete({ where: { id: userId } });
    expect(await repository.updateCurrentUserProfile(userId, { firstName: 'Updated' })).toBeNull();
    expect(await prisma.user.count({ where: { id: userId } })).toBe(0);
  });
  it('accepts concurrent valid updates with last-write-wins and no partial or protected-field mutation', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const sessions = await prisma.refreshSession.findMany({ where: { userId } });
    const vehicles = await prisma.vehicle.findMany({ where: { ownerUserId: userId } });
    const results = await Promise.all([
      repository.updateCurrentUserProfile(userId, { firstName: 'First', lastName: 'PairOne' }),
      repository.updateCurrentUserProfile(userId, { firstName: 'Second', lastName: 'PairTwo' }),
    ]);
    expect(results.every((result) => result?.id === userId)).toBe(true);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(['First:PairOne', 'Second:PairTwo']).toContain(`${after.firstName}:${after.lastName}`);
    expect(
      after.email === before.email &&
        after.passwordHash === before.passwordHash &&
        after.id === before.id,
    ).toBe(true);
    expect(await prisma.vehicle.findMany({ where: { ownerUserId: userId } })).toEqual(vehicles);
    expect(
      JSON.stringify(await prisma.refreshSession.findMany({ where: { userId } })) ===
        JSON.stringify(sessions),
    ).toBe(true);
  });
});
