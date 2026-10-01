import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { PrismaOrganizationRepository } from '../src/organizations/infrastructure/prisma-organization.repository.js';
import { PrismaBranchRepository } from '../src/branches/infrastructure/prisma-branch.repository.js';
import { BranchNotFoundError } from '../src/branches/public.js';
import { PrismaWashBoxRepository } from '../src/wash-boxes/infrastructure/prisma-wash-box.repository.js';
import { WashBoxAlreadyExistsError } from '../src/wash-boxes/application/wash-box.repository.js';
import { getSafeTestDatabaseUrl } from './safe-test-database-url.js';
describe('wash box PostgreSQL constraints, isolation and concurrency', () => {
  let prisma: PrismaService;
  let repository: PrismaWashBoxRepository;
  let userId: string;
  let orgId: string;
  let branchId: string;
  let otherBranchId: string;
  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: getSafeTestDatabaseUrl(process.env) } }),
    );
    await prisma.onModuleInit();
    repository = new PrismaWashBoxRepository(prisma);
  });
  beforeEach(async () => {
    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Owner',
        email: `boxes-${userId}@integration.invalid`,
        passwordHash: 'test-only-hash',
      },
    });
    orgId = (
      await new PrismaOrganizationRepository(prisma).createWithOwnerMembership(userId, {
        name: 'Box Wash',
        description: null,
      })
    ).id;
    const branches = new PrismaBranchRepository(prisma);
    const input = {
      name: 'Branch',
      city: 'Astana',
      addressLine: 'Address 12',
      timeZone: 'Asia/Almaty',
    };
    branchId = (await branches.createBranch(orgId, input)).id;
    otherBranchId = (await branches.createBranch(orgId, input)).id;
  });
  afterEach(async () => {
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    expect(
      await prisma.washBox.count({ where: { branchId: { in: [branchId, otherBranchId] } } }),
    ).toBe(0);
    expect(
      await prisma.branchOpeningHours.count({
        where: { branchId: { in: [branchId, otherBranchId] } },
      }),
    ).toBe(0);
    expect(await prisma.organizationMembership.count({ where: { userId } })).toBe(0);
    expect(await prisma.refreshSession.count({ where: { userId } })).toBe(0);
    expect(await prisma.vehicle.count({ where: { ownerUserId: userId } })).toBe(0);
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });
  it('defaults active, permits unconfigured hours and returns only public projection', async () => {
    const box = await repository.create(branchId, 1);
    expect(box.isActive).toBe(true);
    expect(Object.keys(box).sort()).toEqual(['createdAt', 'id', 'isActive', 'number', 'updatedAt']);
    expect(await prisma.branchOpeningHours.count({ where: { branchId } })).toBe(0);
  });
  it('reserves unique number even while inactive and permits same number in another branch', async () => {
    const box = await repository.create(branchId, 1);
    await repository.setActiveState(branchId, box.id, false);
    await expect(repository.create(branchId, 1)).rejects.toBeInstanceOf(WashBoxAlreadyExistsError);
    expect((await repository.create(otherBranchId, 1)).number).toBe(1);
  });
  it('two concurrent duplicate creates commit one row and one controlled conflict', async () => {
    const result = await Promise.allSettled([
      repository.create(branchId, 5),
      repository.create(branchId, 5),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = result.find((r) => r.status === 'rejected');
    expect(
      failure?.status === 'rejected' && failure.reason instanceof WashBoxAlreadyExistsError,
    ).toBe(true);
    expect(await prisma.washBox.count({ where: { branchId, number: 5 } })).toBe(1);
  });
  it('lists in numeric order including inactive boxes and isolates branches', async () => {
    await repository.create(branchId, 20);
    const one = await repository.create(branchId, 1);
    await repository.create(branchId, 2);
    await repository.setActiveState(branchId, one.id, false);
    await repository.create(otherBranchId, 3);
    const list = await repository.listByBranch(branchId);
    expect(list.map((b) => b.number)).toEqual([1, 2, 20]);
    expect(list[0]?.isActive).toBe(false);
    expect((await repository.findByBranchAndId(branchId, one.id))?.isActive).toBe(false);
    expect(await repository.findByBranchAndId(otherBranchId, one.id)).toBeNull();
    expect(await repository.setActiveState(otherBranchId, one.id, true)).toBeNull();
    expect((await repository.findByBranchAndId(branchId, one.id))?.isActive).toBe(false);
  });
  it('explicit assignments preserve number/createdAt, advance changed updatedAt and preserve no-op time', async () => {
    const box = await repository.create(branchId, 999);
    const old = new Date('2020-01-01T00:00:00Z');
    await prisma.washBox.update({ where: { id: box.id }, data: { updatedAt: old } });
    const disabled = await repository.setActiveState(branchId, box.id, false);
    expect(disabled?.updatedAt.getTime()).toBeGreaterThan(old.getTime());
    expect(disabled?.createdAt).toEqual(box.createdAt);
    expect(disabled?.number).toBe(999);
    const repeated = await repository.setActiveState(branchId, box.id, false);
    expect(repeated).toEqual(disabled);
    expect((await repository.setActiveState(branchId, box.id, true))?.isActive).toBe(true);
  });
  it('concurrent state assignments remain one owned row with a committed explicit state', async () => {
    const box = await repository.create(branchId, 1);
    const other = await repository.create(otherBranchId, 1);
    await Promise.all([
      repository.setActiveState(branchId, box.id, false),
      repository.setActiveState(branchId, box.id, true),
    ]);
    const final = await repository.findByBranchAndId(branchId, box.id);
    expect(typeof final?.isActive).toBe('boolean');
    expect(final?.number).toBe(1);
    expect(await repository.listByBranch(branchId)).toHaveLength(1);
    expect(await repository.findByBranchAndId(otherBranchId, other.id)).toEqual(other);
  });
  it.each([0, 1000, -1])(
    'database rejects invalid number %s without becoming a duplicate',
    async (number) => {
      const result = await repository.create(branchId, number).then(
        () => false,
        (error: unknown) => !(error instanceof WashBoxAlreadyExistsError),
      );
      expect(result).toBe(true);
      expect(await repository.listByBranch(branchId)).toEqual([]);
    },
  );
  it('known vanished parent maps to branch not found and cannot leave an orphan', async () => {
    await prisma.branch.delete({ where: { id: branchId } });
    await expect(repository.create(branchId, 1)).rejects.toBeInstanceOf(BranchNotFoundError);
    expect(await prisma.washBox.count({ where: { branchId } })).toBe(0);
  });
  it('branch/organization cascades boxes while membership still restricts user deletion', async () => {
    const first = await repository.create(branchId, 1);
    await repository.create(otherBranchId, 1);
    await expect(prisma.user.delete({ where: { id: userId } })).rejects.toThrow();
    await prisma.branch.delete({ where: { id: branchId } });
    expect(await prisma.washBox.count({ where: { id: first.id } })).toBe(0);
    expect(await repository.listByBranch(otherBranchId)).toHaveLength(1);
    await prisma.organization.delete({ where: { id: orgId } });
    expect(await prisma.washBox.count({ where: { branchId: otherBranchId } })).toBe(0);
  });
  it('box writes leave branch hours, user, vehicle and refresh sessions unchanged', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    const vehicle = await prisma.vehicle.create({
      data: { ownerUserId: userId, make: 'Toyota', model: 'Camry', plateNumber: '123ABC01' },
    });
    const session = await prisma.refreshSession.create({
      data: { userId, tokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60000) },
    });
    const hours = await prisma.branchOpeningHours.create({
      data: { branchId, dayOfWeek: 'MONDAY', status: 'CLOSED' },
    });
    const box = await repository.create(branchId, 1);
    await repository.setActiveState(branchId, box.id, false);
    expect(await prisma.user.findUnique({ where: { id: userId } })).toEqual(user);
    expect(await prisma.branch.findUnique({ where: { id: branchId } })).toEqual(branch);
    expect(await prisma.vehicle.findUnique({ where: { id: vehicle.id } })).toEqual(vehicle);
    expect(await prisma.refreshSession.findUnique({ where: { id: session.id } })).toEqual(session);
    expect(await prisma.branchOpeningHours.findUnique({ where: { id: hours.id } })).toEqual(hours);
  });
});
