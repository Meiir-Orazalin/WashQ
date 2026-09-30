import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { weekdays } from '@washqueue/contracts';
import { PrismaService } from '../src/database/prisma.service.js';
import { PrismaOrganizationRepository } from '../src/organizations/infrastructure/prisma-organization.repository.js';
import { PrismaBranchRepository } from '../src/branches/infrastructure/prisma-branch.repository.js';
import type { WeeklyOpeningHours } from '../src/branches/domain/branch.js';
import { getSafeTestDatabaseUrl } from './safe-test-database-url.js';
const input = {
  name: 'Branch',
  city: 'Astana',
  addressLine: 'Address 12',
  timeZone: 'Asia/Almaty',
};
const schedule = (offset = 0): WeeklyOpeningHours[] =>
  weekdays.map((dayOfWeek) => ({
    dayOfWeek,
    status: 'OPEN',
    opensAtMinute: 540 + offset,
    closesAtMinute: 1200 + offset,
    closesNextDay: false,
  }));
describe('branch PostgreSQL isolation, constraints and serialized schedules', () => {
  let prisma: PrismaService;
  let repository: PrismaBranchRepository;
  let userId: string;
  let orgId: string;
  let otherOrgId: string;
  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: getSafeTestDatabaseUrl(process.env) } }),
    );
    await prisma.onModuleInit();
    repository = new PrismaBranchRepository(prisma);
  });
  beforeEach(async () => {
    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Owner',
        email: `branch-${userId}@integration.invalid`,
        passwordHash: 'test-only-hash',
      },
    });
    const organizations = new PrismaOrganizationRepository(prisma);
    orgId = (
      await organizations.createWithOwnerMembership(userId, { name: 'Wash', description: null })
    ).id;
    otherOrgId = (
      await organizations.createWithOwnerMembership(userId, { name: 'Wash', description: null })
    ).id;
  });
  afterEach(async () => {
    const ids = (
      await prisma.branch.findMany({
        where: { organizationId: { in: [orgId, otherOrgId] } },
        select: { id: true },
      })
    ).map((row) => row.id);
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    expect(await prisma.branchOpeningHours.count({ where: { branchId: { in: ids } } })).toBe(0);
    expect(
      await prisma.branch.count({ where: { organizationId: { in: [orgId, otherOrgId] } } }),
    ).toBe(0);
    expect(await prisma.organizationMembership.count({ where: { userId } })).toBe(0);
    expect(await prisma.refreshSession.count({ where: { userId } })).toBe(0);
    expect(await prisma.vehicle.count({ where: { ownerUserId: userId } })).toBe(0);
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });
  it('creates public branch, permits duplicate names and returns unconfigured detail', async () => {
    const branch = await repository.createBranch(orgId, input);
    await repository.createBranch(orgId, input);
    await repository.createBranch(otherOrgId, input);
    expect(await repository.listBranchesByOrganization(orgId)).toHaveLength(2);
    expect(await repository.listBranchesByOrganization(otherOrgId)).toHaveLength(1);
    expect(branch).not.toHaveProperty('organizationId');
    expect(
      (await repository.findBranchByOrganizationAndId(orgId, branch.id))?.openingHours,
    ).toEqual([]);
    expect(await repository.findBranchByOrganizationAndId(otherOrgId, branch.id)).toBeNull();
    expect(await repository.replaceOpeningHours(otherOrgId, branch.id, schedule())).toBeNull();
  });
  it('orders createdAt DESC and UUID DESC deterministically', async () => {
    const older = await repository.createBranch(orgId, input);
    const a = await repository.createBranch(orgId, input);
    const b = await repository.createBranch(orgId, input);
    const date = new Date('2026-09-30T00:00:00Z');
    await prisma.branch.updateMany({
      where: { id: { in: [a.id, b.id] } },
      data: { createdAt: date },
    });
    await prisma.branch.updateMany({
      where: { id: older.id },
      data: { createdAt: new Date(date.getTime() - 1000) },
    });
    expect((await repository.listBranchesByOrganization(orgId)).map((row) => row.id)).toEqual(
      [a.id, b.id].sort().reverse().concat(older.id),
    );
  });
  it('persists seven local days and all statuses, overnight, and exact minutes', async () => {
    const branch = await repository.createBranch(orgId, input);
    const week = schedule();
    week[4] = {
      dayOfWeek: 'FRIDAY',
      status: 'OPEN',
      opensAtMinute: 1320,
      closesAtMinute: 120,
      closesNextDay: true,
    };
    week[5] = {
      dayOfWeek: 'SATURDAY',
      status: 'OPEN_24_HOURS',
      opensAtMinute: null,
      closesAtMinute: null,
      closesNextDay: false,
    };
    week[6] = {
      dayOfWeek: 'SUNDAY',
      status: 'CLOSED',
      opensAtMinute: null,
      closesAtMinute: null,
      closesNextDay: false,
    };
    expect(await repository.replaceOpeningHours(orgId, branch.id, [...week].reverse())).toEqual(
      week,
    );
    expect(
      (await repository.findBranchByOrganizationAndId(orgId, branch.id))?.openingHours,
    ).toEqual(week);
    expect(await prisma.branchOpeningHours.count({ where: { branchId: branch.id } })).toBe(7);
  });
  for (const invalid of [
    { opensAtMinute: -1 },
    { closesAtMinute: 1440 },
    { opensAtMinute: 1200, closesAtMinute: 1200 },
    { closesNextDay: true },
    { status: 'CLOSED' as const },
    { status: 'OPEN_24_HOURS' as const },
    { opensAtMinute: null },
  ])
    it('database rejects invalid interval and rollback preserves prior full schedule', async () => {
      const branch = await repository.createBranch(orgId, input);
      const old = schedule();
      await repository.replaceOpeningHours(orgId, branch.id, old);
      const bad = schedule(1);
      bad[3] = {
        dayOfWeek: 'THURSDAY',
        status: 'OPEN',
        opensAtMinute: 541,
        closesAtMinute: 1201,
        closesNextDay: false,
        ...invalid,
      };
      await expect(repository.replaceOpeningHours(orgId, branch.id, bad)).rejects.toThrow();
      expect(
        (await repository.findBranchByOrganizationAndId(orgId, branch.id))?.openingHours,
      ).toEqual(old);
    });
  it('rejects duplicate weekday and partial replacements without losing saved week', async () => {
    const branch = await repository.createBranch(orgId, input);
    await repository.replaceOpeningHours(orgId, branch.id, schedule());
    await expect(async () =>
      repository.replaceOpeningHours(orgId, branch.id, schedule().slice(1)),
    ).rejects.toThrow();
    const duplicate = schedule();
    const first = duplicate[0];
    if (!first) throw new Error('Missing fixture weekday');
    duplicate[6] = first;
    await expect(async () =>
      repository.replaceOpeningHours(orgId, branch.id, duplicate),
    ).rejects.toThrow();
    expect(
      (await repository.findBranchByOrganizationAndId(orgId, branch.id))?.openingHours,
    ).toEqual(schedule());
    await expect(
      prisma.branchOpeningHours.create({ data: { branchId: branch.id, ...first } }),
    ).rejects.toThrow();
  });
  it('serializes simultaneous complete replacements without mixed weekdays', async () => {
    const branch = await repository.createBranch(orgId, input);
    const a = schedule();
    const b = schedule(10);
    const results = await Promise.all([
      repository.replaceOpeningHours(orgId, branch.id, a),
      repository.replaceOpeningHours(orgId, branch.id, b),
    ]);
    expect(results).toEqual([a, b]);
    const final = (await repository.findBranchByOrganizationAndId(orgId, branch.id))?.openingHours;
    expect(
      JSON.stringify(final) === JSON.stringify(a) || JSON.stringify(final) === JSON.stringify(b),
    ).toBe(true);
  });
  it('cascades branch and organization schedules, retains user restriction and unrelated customer records', async () => {
    const vehicle = await prisma.vehicle.create({
      data: { ownerUserId: userId, make: 'Toyota', model: 'Camry', plateNumber: '123ABC' },
    });
    const session = await prisma.refreshSession.create({
      data: {
        userId,
        tokenHash: randomUUID().replaceAll('-', '').repeat(2),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const branch = await repository.createBranch(orgId, input);
    await repository.replaceOpeningHours(orgId, branch.id, schedule());
    await expect(prisma.user.delete({ where: { id: userId } })).rejects.toThrow();
    await prisma.branch.delete({ where: { id: branch.id } });
    expect(await prisma.branchOpeningHours.count({ where: { branchId: branch.id } })).toBe(0);
    const other = await repository.createBranch(orgId, input);
    await repository.replaceOpeningHours(orgId, other.id, schedule());
    await prisma.organization.delete({ where: { id: orgId } });
    expect(await prisma.branch.count({ where: { id: other.id } })).toBe(0);
    expect(await prisma.branchOpeningHours.count({ where: { branchId: other.id } })).toBe(0);
    expect(await prisma.vehicle.findUnique({ where: { id: vehicle.id } })).toEqual(vehicle);
    expect(await prisma.refreshSession.findUnique({ where: { id: session.id } })).toEqual(session);
  });
});
