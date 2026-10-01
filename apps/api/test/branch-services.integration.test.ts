import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { PrismaOrganizationRepository } from '../src/organizations/infrastructure/prisma-organization.repository.js';
import { PrismaBranchRepository } from '../src/branches/infrastructure/prisma-branch.repository.js';
import { BranchNotFoundError } from '../src/branches/public.js';
import { PrismaBranchServiceRepository } from '../src/branch-services/infrastructure/prisma-branch-service.repository.js';
import { getSafeTestDatabaseUrl } from './safe-test-database-url.js';
describe('branch service PostgreSQL constraints, partial patches and concurrency', () => {
  let prisma: PrismaService;
  let repository: PrismaBranchServiceRepository;
  let userId: string;
  let orgId: string;
  let branchId: string;
  let otherBranchId: string;
  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: getSafeTestDatabaseUrl(process.env) } }),
    );
    await prisma.onModuleInit();
    repository = new PrismaBranchServiceRepository(prisma);
  });
  beforeEach(async () => {
    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Owner',
        email: `services-${userId}@integration.invalid`,
        passwordHash: 'test-only-hash',
      },
    });
    orgId = (
      await new PrismaOrganizationRepository(prisma).createWithOwnerMembership(userId, {
        name: 'Service Wash',
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
      await prisma.branchService.count({ where: { branchId: { in: [branchId, otherBranchId] } } }),
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
  const input = {
    name: 'Exterior wash',
    description: 'Plain',
    durationMinutes: 30,
    priceMinor: 500000,
    currency: 'KZT' as const,
  };
  it('persists complete public values, default active, nullable description and nonunique names', async () => {
    const service = await repository.create(branchId, { ...input, description: null });
    expect(service).toMatchObject({ ...input, description: null, isActive: true });
    expect(Object.keys(service).sort()).toEqual([
      'createdAt',
      'currency',
      'description',
      'durationMinutes',
      'id',
      'isActive',
      'name',
      'priceMinor',
      'updatedAt',
    ]);
    expect((await repository.create(branchId, input)).name).toBe(input.name);
    expect((await repository.create(otherBranchId, input)).name).toBe(input.name);
    expect(await prisma.branchOpeningHours.count({ where: { branchId } })).toBe(0);
  });
  it('lists active/inactive by descending createdAt and ID with branch isolation', async () => {
    const first = await repository.create(branchId, input);
    const second = await repository.create(branchId, input);
    await repository.create(otherBranchId, input);
    const same = new Date('2020-01-01T00:00:00Z');
    await prisma.branchService.updateMany({ where: { branchId }, data: { createdAt: same } });
    await repository.updateByBranchAndId(branchId, first.id, { isActive: false });
    const list = await repository.listByBranch(branchId);
    expect(list.map((s) => s.id)).toEqual([first.id, second.id].sort().reverse());
    expect(list.find((s) => s.id === first.id)?.isActive).toBe(false);
    expect(await repository.findByBranchAndId(otherBranchId, first.id)).toBeNull();
    expect(
      await repository.updateByBranchAndId(otherBranchId, first.id, { priceMinor: 1 }),
    ).toBeNull();
    expect((await repository.findByBranchAndId(branchId, first.id))?.priceMinor).toBe(
      input.priceMinor,
    );
  });
  it('atomic combined patch changes only supplied fields, clears description and advances timestamp', async () => {
    const service = await repository.create(branchId, input);
    const updated = await repository.updateByBranchAndId(branchId, service.id, {
      priceMinor: 500050,
      durationMinutes: 45,
      description: null,
    });
    expect(updated).toMatchObject({
      ...service,
      updatedAt: expect.any(Date),
      priceMinor: 500050,
      durationMinutes: 45,
      description: null,
    });
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(service.updatedAt.getTime());
    expect(updated?.createdAt).toEqual(service.createdAt);
    const row = await prisma.branchService.findUniqueOrThrow({ where: { id: service.id } });
    expect(row.branchId).toBe(branchId);
    expect(row.currency).toBe('KZT');
  });
  it('explicit state setting is repeatable and no-op preserves updatedAt', async () => {
    const service = await repository.create(branchId, input);
    const disabled = await repository.updateByBranchAndId(branchId, service.id, {
      isActive: false,
    });
    expect(disabled?.isActive).toBe(false);
    expect(await repository.updateByBranchAndId(branchId, service.id, { isActive: false })).toEqual(
      disabled,
    );
    expect((await repository.findByBranchAndId(branchId, service.id))?.isActive).toBe(false);
    expect(
      (await repository.updateByBranchAndId(branchId, service.id, { isActive: true }))?.isActive,
    ).toBe(true);
  });
  it('concurrent independent field updates never overwrite omitted columns', async () => {
    const service = await repository.create(branchId, input);
    const other = await repository.create(otherBranchId, input);
    await Promise.all([
      repository.updateByBranchAndId(branchId, service.id, { priceMinor: 101 }),
      repository.updateByBranchAndId(branchId, service.id, { durationMinutes: 91 }),
    ]);
    expect(await repository.findByBranchAndId(branchId, service.id)).toMatchObject({
      priceMinor: 101,
      durationMinutes: 91,
      name: input.name,
    });
    expect(await repository.findByBranchAndId(otherBranchId, other.id)).toEqual(other);
  });
  it('concurrent whole price/duration patches remain a complete committed pair', async () => {
    const service = await repository.create(branchId, input);
    await Promise.all([
      repository.updateByBranchAndId(branchId, service.id, {
        priceMinor: 101,
        durationMinutes: 11,
      }),
      repository.updateByBranchAndId(branchId, service.id, {
        priceMinor: 202,
        durationMinutes: 22,
      }),
    ]);
    const final = await repository.findByBranchAndId(branchId, service.id);
    expect([
      [101, 11],
      [202, 22],
    ]).toContainEqual([final?.priceMinor, final?.durationMinutes]);
  });
  it.each([
    { durationMinutes: 0 },
    { durationMinutes: 1441 },
    { priceMinor: 0 },
    { priceMinor: 100000001 },
    { currency: 'USD' },
  ])('database rejects direct invalid row', async (patch) => {
    await expect(
      prisma.branchService.create({ data: { branchId, ...input, ...patch } }),
    ).rejects.toThrow();
    expect(await repository.listByBranch(branchId)).toEqual([]);
  });
  it('invalid combined patch rolls back the entire row and leaves prior valid pair intact', async () => {
    const service = await repository.create(branchId, input);
    await expect(
      repository.updateByBranchAndId(branchId, service.id, { priceMinor: 0, durationMinutes: 45 }),
    ).rejects.toThrow();
    expect(await repository.findByBranchAndId(branchId, service.id)).toEqual(service);
  });
  it('known deleted parent maps narrowly to branch not found, with no orphan', async () => {
    await prisma.branch.delete({ where: { id: branchId } });
    await expect(repository.create(branchId, input)).rejects.toBeInstanceOf(BranchNotFoundError);
    expect(await prisma.branchService.count({ where: { branchId } })).toBe(0);
  });
  it('branch/organization cascade services and preserve user membership RESTRICT', async () => {
    await repository.create(branchId, input);
    await repository.create(otherBranchId, input);
    await expect(prisma.user.delete({ where: { id: userId } })).rejects.toThrow();
    await prisma.branch.delete({ where: { id: branchId } });
    expect(await repository.listByBranch(branchId)).toEqual([]);
    expect(await repository.listByBranch(otherBranchId)).toHaveLength(1);
    await prisma.organization.delete({ where: { id: orgId } });
    expect(await repository.listByBranch(otherBranchId)).toEqual([]);
  });
  it('service writes do not change boxes, hours, user, vehicles or refresh sessions', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    const box = await prisma.washBox.create({ data: { branchId, number: 1 } });
    const vehicle = await prisma.vehicle.create({
      data: { ownerUserId: userId, make: 'Toyota', model: 'Camry', plateNumber: '123ABC01' },
    });
    const session = await prisma.refreshSession.create({
      data: {
        userId,
        tokenHash: randomUUID().replaceAll('-', '').repeat(2),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const hours = await prisma.branchOpeningHours.create({
      data: { branchId, dayOfWeek: 'MONDAY', status: 'CLOSED' },
    });
    const service = await repository.create(branchId, input);
    await repository.updateByBranchAndId(branchId, service.id, {
      name: 'New wash',
      priceMinor: 1,
      durationMinutes: 1,
      description: null,
      isActive: false,
    });
    expect(await prisma.user.findUnique({ where: { id: userId } })).toEqual(user);
    expect(await prisma.branch.findUnique({ where: { id: branchId } })).toEqual(branch);
    expect(await prisma.washBox.findUnique({ where: { id: box.id } })).toEqual(box);
    expect(await prisma.vehicle.findUnique({ where: { id: vehicle.id } })).toEqual(vehicle);
    expect(await prisma.refreshSession.findUnique({ where: { id: session.id } })).toEqual(session);
    expect(await prisma.branchOpeningHours.findUnique({ where: { id: hours.id } })).toEqual(hours);
  });
});
