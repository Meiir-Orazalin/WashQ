import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { PrismaOrganizationRepository } from '../src/organizations/infrastructure/prisma-organization.repository.js';
import { PrismaUserRepository } from '../src/users/infrastructure/prisma-user.repository.js';
import { CreateOrganizationUseCase } from '../src/organizations/application/create-organization.use-case.js';
import { JoseAccessTokenService } from '../src/auth/infrastructure/jose-access-token.service.js';
import { getSafeTestDatabaseUrl } from './safe-test-database-url.js';
import { createOrganizationTestApp } from './organization-test-app.js';

describe('organization PostgreSQL integrity and ownership', () => {
  let prisma: PrismaService;
  let repository: PrismaOrganizationRepository;
  let ownerId: string;
  let otherId: string;
  const ownedIds: string[] = [];
  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: getSafeTestDatabaseUrl(process.env) } }),
    );
    await prisma.onModuleInit();
    repository = new PrismaOrganizationRepository(prisma);
  });
  beforeEach(async () => {
    ownerId = randomUUID();
    otherId = randomUUID();
    ownedIds.length = 0;
    await prisma.user.createMany({
      data: [ownerId, otherId].map((id) => ({
        id,
        firstName: 'Owner',
        email: `organization-${id}@integration.invalid`,
        passwordHash: 'test-only-stored-hash',
      })),
    });
  });
  afterEach(async () => {
    const rows = await prisma.organization.findMany({
      where: { memberships: { some: { userId: { in: [ownerId, otherId] } } } },
      select: { id: true },
    });
    const ids = [...ownedIds, ...rows.map(({ id }) => id)];
    await prisma.organization.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    expect(await prisma.organization.count({ where: { id: { in: ids } } })).toBe(0);
    expect(
      await prisma.organizationMembership.count({
        where: { OR: [{ organizationId: { in: ids } }, { userId: { in: [ownerId, otherId] } }] },
      }),
    ).toBe(0);
    expect(await prisma.user.count({ where: { id: { in: [ownerId, otherId] } } })).toBe(0);
    expect(await prisma.vehicle.count({ where: { ownerUserId: { in: [ownerId, otherId] } } })).toBe(
      0,
    );
    expect(
      await prisma.refreshSession.count({ where: { userId: { in: [ownerId, otherId] } } }),
    ).toBe(0);
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });
  async function create(userId = ownerId, name = 'Wash') {
    const organization = await repository.createWithOwnerMembership(userId, {
      name,
      description: null,
    });
    ownedIds.push(organization.id);
    return organization;
  }
  it('atomically persists normalized values, only public output and one authenticated OWNER membership', async () => {
    const result = await new CreateOrganizationUseCase(repository).execute(ownerId, {
      name: ' Ｗash   Centre ',
      description: ' Line one\nLine two ',
    });
    ownedIds.push(result.id);
    expect(result.name).toBe('Wash Centre');
    expect(result.description).toBe('Line one\nLine two');
    expect(Object.keys(result).sort()).toEqual([
      'createdAt',
      'description',
      'id',
      'name',
      'updatedAt',
    ]);
    const memberships = await prisma.organizationMembership.findMany({
      where: { organizationId: result.id },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ userId: ownerId, role: 'OWNER' });
    expect(await repository.findOwnedById(ownerId, result.id)).toEqual(result);
  });
  it('permits multiple organizations and identical names for the same and different users', async () => {
    await create();
    await create();
    await create(otherId);
    expect(await repository.listOwnedByUser(ownerId)).toHaveLength(2);
    expect(await repository.listOwnedByUser(otherId)).toHaveLength(1);
  });
  it('orders only owned organizations by creation descending and UUID descending for ties', async () => {
    const first = await create();
    const second = await create();
    const newer = await create();
    await create(otherId);
    await prisma.organization.updateMany({
      where: { id: { in: [first.id, second.id] } },
      data: { createdAt: new Date('2026-01-01T00:00:00Z') },
    });
    const ties = [first.id, second.id].sort().reverse();
    expect((await repository.listOwnedByUser(ownerId)).map(({ id }) => id)).toEqual([
      newer.id,
      ...ties,
    ]);
  });
  it('returns an empty owner list and no foreign or missing detail', async () => {
    const organization = await create();
    expect(await repository.listOwnedByUser(otherId)).toEqual([]);
    expect(await repository.findOwnedById(otherId, organization.id)).toBeNull();
    expect(await repository.findOwnedById(ownerId, randomUUID())).toBeNull();
  });
  it('enforces unique organization/user membership but permits future multiple owners in schema', async () => {
    const organization = await create();
    const duplicate = await prisma.organizationMembership
      .create({ data: { organizationId: organization.id, userId: ownerId, role: 'OWNER' } })
      .then(
        () => false,
        () => true,
      );
    expect(duplicate).toBe(true);
    await prisma.organizationMembership.create({
      data: { organizationId: organization.id, userId: otherId, role: 'OWNER' },
    });
    expect(await repository.findOwnedById(otherId, organization.id)).toEqual(organization);
  });
  it('rolls back organization creation when the owner FK fails, without any orphan', async () => {
    const name = `Rollback ${randomUUID()}`;
    const beforeMemberships = await prisma.organizationMembership.count();
    const failed = await repository
      .createWithOwnerMembership(randomUUID(), { name, description: null })
      .then(
        () => false,
        () => true,
      );
    expect(failed).toBe(true);
    expect(await prisma.organization.count({ where: { name } })).toBe(0);
    expect(await prisma.organizationMembership.count()).toBe(beforeMemberships);
  });
  it('enforces membership organization FK without creating an orphan membership', async () => {
    const organizationId = randomUUID();
    const failed = await prisma.organizationMembership
      .create({ data: { organizationId, userId: ownerId, role: 'OWNER' } })
      .then(
        () => false,
        () => true,
      );
    expect(failed).toBe(true);
    expect(await prisma.organizationMembership.count({ where: { organizationId } })).toBe(0);
  });
  it('restricts deleting a member user; fixture organization deletion cascades only its memberships', async () => {
    const organization = await create();
    const other = await create(otherId);
    const failed = await prisma.user.delete({ where: { id: ownerId } }).then(
      () => false,
      () => true,
    );
    expect(failed).toBe(true);
    expect(await repository.findOwnedById(ownerId, organization.id)).toEqual(organization);
    await prisma.organization.delete({ where: { id: organization.id } });
    expect(
      await prisma.organizationMembership.count({ where: { organizationId: organization.id } }),
    ).toBe(0);
    expect(await repository.findOwnedById(otherId, other.id)).toEqual(other);
    await prisma.user.delete({ where: { id: ownerId } });
  });
  it('leaves user, vehicle and refresh-session state unchanged, including after restricted deletion', async () => {
    await prisma.vehicle.create({
      data: { ownerUserId: ownerId, make: 'Toyota', model: 'Camry', plateNumber: '123ABC01' },
    });
    await prisma.refreshSession.create({
      data: {
        userId: ownerId,
        tokenHash: randomUUID().replaceAll('-', '').repeat(2),
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
    });
    const before = JSON.stringify(
      await Promise.all([
        prisma.user.findMany({ where: { id: { in: [ownerId, otherId] } } }),
        prisma.vehicle.findMany({ where: { ownerUserId: ownerId } }),
        prisma.refreshSession.findMany({ where: { userId: ownerId } }),
      ]),
    );
    await create();
    await repository.listOwnedByUser(ownerId);
    await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    const after = JSON.stringify(
      await Promise.all([
        prisma.user.findMany({ where: { id: { in: [ownerId, otherId] } } }),
        prisma.vehicle.findMany({ where: { ownerUserId: ownerId } }),
        prisma.refreshSession.findMany({ where: { userId: ownerId } }),
      ]),
    );
    expect(after === before).toBe(true);
  });
  it('enforces ownership through real authenticated HTTP and identical foreign/missing 404', async () => {
    const tokens = new JoseAccessTokenService({
      signingSecret: 's'.repeat(48),
      lifetimeSeconds: 900,
    });
    const app = await createOrganizationTestApp(
      new PrismaUserRepository(prisma),
      tokens,
      repository,
    );
    const tokenA = (await tokens.issue({ subject: ownerId })).token;
    const tokenB = (await tokens.issue({ subject: otherId })).token;
    try {
      const first = await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Same name' })
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Same name' })
        .expect(201);
      const listA = await request(app.getHttpServer())
        .get('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const listB = await request(app.getHttpServer())
        .get('/api/v1/organizations')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(listA.body.organizations).toEqual([first.body.organization]);
      expect(listB.body.organizations).toEqual([second.body.organization]);
      const foreign = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${first.body.organization.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      const missing = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${randomUUID()}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      expect(foreign.body.error).toEqual(missing.body.error);
      expect((await repository.findOwnedById(ownerId, first.body.organization.id))?.name).toBe(
        'Same name',
      );
    } finally {
      await app.close();
    }
  });
  it('has timezone-aware timestamps, required indexes, scoped role and restrictive/cascading FKs', async () => {
    const columns = await prisma.$queryRaw<
      { table_name: string; column_name: string; data_type: string }[]
    >`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('organizations', 'organization_memberships')`;
    expect(columns.filter(({ table_name }) => table_name === 'organizations')).toHaveLength(5);
    expect(
      columns.filter(({ table_name }) => table_name === 'organization_memberships'),
    ).toHaveLength(5);
    expect(
      columns
        .filter(({ column_name }) => column_name.endsWith('_at'))
        .every(({ data_type }) => data_type === 'timestamp with time zone'),
    ).toBe(true);
    const indexes = await prisma.$queryRaw<
      { indexdef: string }[]
    >`SELECT indexdef FROM pg_indexes WHERE tablename = 'organization_memberships'`;
    expect(indexes.some(({ indexdef }) => indexdef.includes('(user_id, role)'))).toBe(true);
    expect(
      indexes.some(
        ({ indexdef }) =>
          indexdef.includes('UNIQUE') && indexdef.includes('(organization_id, user_id)'),
      ),
    ).toBe(true);
    const roles = await prisma.$queryRaw<
      { enumlabel: string }[]
    >`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'organization_membership_role'`;
    expect(roles).toEqual([{ enumlabel: 'OWNER' }]);
    const fks = await prisma.$queryRaw<
      { definition: string }[]
    >`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'organization_memberships'::regclass AND contype = 'f'`;
    expect(
      fks.some(
        ({ definition }) =>
          definition.includes('REFERENCES users(id)') && definition.includes('ON DELETE RESTRICT'),
      ),
    ).toBe(true);
    expect(
      fks.some(
        ({ definition }) =>
          definition.includes('REFERENCES organizations(id)') &&
          definition.includes('ON DELETE CASCADE'),
      ),
    ).toBe(true);
  });
});
