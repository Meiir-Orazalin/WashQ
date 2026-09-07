import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JoseAccessTokenService } from '../src/auth/infrastructure/jose-access-token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PrismaUserRepository } from '../src/users/infrastructure/prisma-user.repository.js';
import { CreateVehicleUseCase } from '../src/vehicles/application/create-vehicle.use-case.js';
import { VehicleAlreadyExistsError } from '../src/vehicles/application/vehicle.repository.js';
import { PrismaVehicleRepository } from '../src/vehicles/infrastructure/prisma-vehicle.repository.js';
import { getSafeTestDatabaseUrl } from './safe-test-database-url.js';
import { createVehicleTestApp } from './vehicle-test-app.js';

describe('PostgreSQL vehicle ownership and atomic uniqueness', () => {
  let prisma: PrismaService;
  let repository: PrismaVehicleRepository;
  let create: CreateVehicleUseCase;
  let ownerA: string;
  let ownerB: string;
  const fixtureOwners: string[] = [];
  const input = { make: ' Toyota ', model: ' Camry ', plateNumber: '123 ABC 01' };
  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: getSafeTestDatabaseUrl(process.env) } }),
    );
    await prisma.$connect();
    repository = new PrismaVehicleRepository(prisma);
    create = new CreateVehicleUseCase(repository);
  });
  beforeEach(async () => {
    for (const identity of ['a', 'b']) {
      const user = await prisma.user.create({
        data: {
          firstName: 'Vehicle fixture',
          email: `vehicle-integration-${identity}@vehicles-test.invalid`,
          passwordHash: 'non-credential-fixture-hash',
        },
        select: { id: true },
      });
      fixtureOwners.push(user.id);
    }
    const [a, b] = fixtureOwners;
    if (!a || !b) throw new Error('Two fixture owners are required');
    ownerA = a;
    ownerB = b;
  });
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: fixtureOwners } } });
    expect(await prisma.vehicle.count({ where: { ownerUserId: { in: fixtureOwners } } })).toBe(0);
    expect(await prisma.refreshSession.count({ where: { userId: { in: fixtureOwners } } })).toBe(0);
    fixtureOwners.length = 0;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists canonical fields, UUID, timestamps and nullable optionals without owner projection', async () => {
    const vehicle = await create.execute(ownerA, input);
    expect(vehicle).toMatchObject({
      make: 'Toyota',
      model: 'Camry',
      plateNumber: '123ABC01',
      productionYear: null,
      color: null,
    });
    expect(vehicle.createdAt).toBeInstanceOf(Date);
    expect(vehicle.updatedAt).toBeInstanceOf(Date);
    expect(vehicle).not.toHaveProperty('ownerUserId');
    const persisted = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(persisted.ownerUserId).toBe(ownerA);
    expect(persisted.plateNumber).toBe('123ABC01');
  });
  it('saves supplied year and normalized color', async () => {
    expect(
      await create.execute(ownerA, { ...input, productionYear: 2024, color: ' Dark  Blue ' }),
    ).toMatchObject({ productionYear: 2024, color: 'Dark Blue' });
  });
  it('isolates listing and allows one canonical plate under different owners', async () => {
    const a = await create.execute(ownerA, input);
    expect(await repository.listByOwner(ownerB)).toEqual([]);
    const b = await create.execute(ownerB, input);
    expect((await repository.listByOwner(ownerA)).map(({ id }) => id)).toEqual([a.id]);
    expect((await repository.listByOwner(ownerB)).map(({ id }) => id)).toEqual([b.id]);
  });
  it('orders by descending creation time and descending UUID tie-breaker', async () => {
    const timestamp = new Date('2026-09-07T10:00:00Z');
    const ids = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ];
    for (const [index, id] of ids.entries())
      await prisma.vehicle.create({
        data: {
          id,
          ownerUserId: ownerA,
          make: 'Test',
          model: 'Order',
          plateNumber: `ORDER${index}`,
          createdAt: index === 0 ? new Date(timestamp.getTime() + 1000) : timestamp,
        },
      });
    expect((await repository.listByOwner(ownerA)).map(({ id }) => id)).toEqual([
      ids[0],
      ids[2],
      ids[1],
    ]);
  });
  it('maps equivalent-format same-owner duplicates to a controlled conflict', async () => {
    await create.execute(ownerA, input);
    await expect(
      create.execute(ownerA, { ...input, plateNumber: '123-abc-01' }),
    ).rejects.toBeInstanceOf(VehicleAlreadyExistsError);
    expect(await prisma.vehicle.count({ where: { ownerUserId: ownerA } })).toBe(1);
  });
  it('enforces the ownership foreign key and cascades vehicles and refresh sessions on user deletion', async () => {
    const vehicle = await create.execute(ownerA, input);
    await expect(create.execute(randomUUID(), input)).rejects.toMatchObject({ code: 'P2003' });
    const session = await prisma.refreshSession.create({
      data: {
        userId: ownerA,
        tokenHash: 'f'.repeat(64),
        expiresAt: new Date('2030-01-01T00:00:00Z'),
      },
      select: { id: true },
    });
    await prisma.user.delete({ where: { id: ownerA } });
    expect(await prisma.vehicle.count({ where: { id: vehicle.id } })).toBe(0);
    expect(await prisma.refreshSession.count({ where: { id: session.id } })).toBe(0);
  });
  it('uses UUID, timezone-aware timestamps, composite uniqueness and the owner ordering index', async () => {
    const columns = await prisma.$queryRaw<
      { column_name: string; data_type: string }[]
    >`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vehicles'`;
    expect(columns).toHaveLength(9);
    expect(columns).toEqual(
      expect.arrayContaining([
        { column_name: 'id', data_type: 'uuid' },
        { column_name: 'owner_user_id', data_type: 'uuid' },
        { column_name: 'created_at', data_type: 'timestamp with time zone' },
        { column_name: 'updated_at', data_type: 'timestamp with time zone' },
      ]),
    );
    const indexes = await prisma.$queryRaw<
      { indexdef: string }[]
    >`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'vehicles'`;
    expect(
      indexes.some(
        ({ indexdef }) =>
          indexdef.includes('UNIQUE') && indexdef.includes('(owner_user_id, plate_number)'),
      ),
    ).toBe(true);
    expect(
      indexes.some(({ indexdef }) =>
        indexdef.includes('(owner_user_id, created_at DESC, id DESC)'),
      ),
    ).toBe(true);
  });
  it('serves two concurrent equivalent HTTP requests as exactly one 201 and one 409, preserving other owners', async () => {
    const tokens = new JoseAccessTokenService({
      signingSecret: 's'.repeat(48),
      lifetimeSeconds: 900,
    });
    const tokenA = (await tokens.issue({ subject: ownerA })).token;
    const tokenB = (await tokens.issue({ subject: ownerB })).token;
    const app = await createVehicleTestApp(repository, new PrismaUserRepository(prisma), tokens);
    try {
      const other = await request(app.getHttpServer())
        .post('/api/v1/vehicles')
        .set('Authorization', `Bearer ${tokenB}`)
        .send(input)
        .expect(201);
      const responses = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/vehicles')
          .set('Authorization', `Bearer ${tokenA}`)
          .send(input),
        request(app.getHttpServer())
          .post('/api/v1/vehicles')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ ...input, plateNumber: '123-abc-01' }),
      ]);
      expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
      expect(responses.find(({ status }) => status === 409)?.body.error.code).toBe(
        'VEHICLE_ALREADY_EXISTS',
      );
      expect(await prisma.vehicle.count({ where: { ownerUserId: ownerA } })).toBe(1);
      const listedA = await request(app.getHttpServer())
        .get('/api/v1/vehicles')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const listedB = await request(app.getHttpServer())
        .get('/api/v1/vehicles')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(listedA.body.vehicles).toHaveLength(1);
      expect(listedB.body.vehicles).toEqual([other.body.vehicle]);
      expect(listedA.body.vehicles[0].id === listedB.body.vehicles[0].id).toBe(false);
      await request(app.getHttpServer())
        .post('/api/v1/vehicles')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ...input, ownerUserId: ownerB })
        .expect(400);
      await prisma.user.delete({ where: { id: ownerA } });
      await request(app.getHttpServer())
        .get('/api/v1/vehicles')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(401);
    } finally {
      await app.close();
    }
  });
});
