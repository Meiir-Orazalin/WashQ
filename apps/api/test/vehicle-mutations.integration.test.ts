import { createHash, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JoseAccessTokenService } from '../src/auth/infrastructure/jose-access-token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PrismaUserRepository } from '../src/users/infrastructure/prisma-user.repository.js';
import { CreateVehicleUseCase } from '../src/vehicles/application/create-vehicle.use-case.js';
import { UpdateCurrentUserVehicleUseCase } from '../src/vehicles/application/update-current-user-vehicle.use-case.js';
import { VehicleAlreadyExistsError } from '../src/vehicles/application/vehicle.repository.js';
import { PrismaVehicleRepository } from '../src/vehicles/infrastructure/prisma-vehicle.repository.js';
import type { Vehicle } from '../src/vehicles/domain/vehicle.js';
import { getSafeTestDatabaseUrl } from './safe-test-database-url.js';
import { createVehicleTestApp } from './vehicle-test-app.js';

describe('PostgreSQL owner-scoped vehicle mutations', () => {
  let prisma: PrismaService;
  let repository: PrismaVehicleRepository;
  let update: UpdateCurrentUserVehicleUseCase;
  let app: INestApplication;
  const http = (method: 'patch' | 'delete', path: string) =>
    request(app.getHttpServer())[method](path);
  let ownerA: string;
  let ownerB: string;
  let tokenA: string;
  let tokenB: string;
  let first: Vehicle;
  let second: Vehicle;
  let foreign: Vehicle;
  const fixtureOwners: string[] = [];
  const tokens = new JoseAccessTokenService({
    signingSecret: 'test-vehicle-mutations-'.repeat(3),
    lifetimeSeconds: 900,
  });

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService({ database: { url: getSafeTestDatabaseUrl(process.env) } }),
    );
    await prisma.$connect();
    repository = new PrismaVehicleRepository(prisma);
    update = new UpdateCurrentUserVehicleUseCase(repository);
    app = await createVehicleTestApp(repository, new PrismaUserRepository(prisma), tokens);
  });
  beforeEach(async () => {
    for (const label of ['a', 'b']) {
      const user = await prisma.user.create({
        data: {
          firstName: 'Mutation fixture',
          email: `vehicle-mutation-${label}@vehicles-test.invalid`,
          passwordHash: 'non-credential-fixture-hash',
        },
        select: { id: true },
      });
      fixtureOwners.push(user.id);
      await prisma.refreshSession.create({
        data: {
          userId: user.id,
          tokenHash: createHash('sha256')
            .update(`vehicle-mutation-fixture:${user.id}`)
            .digest('hex'),
          expiresAt: new Date('2035-01-01T00:00:00Z'),
        },
        select: { id: true },
      });
    }
    const [a, b] = fixtureOwners;
    if (!a || !b) throw new Error('Two fixture owners required');
    ownerA = a;
    ownerB = b;
    tokenA = (await tokens.issue({ subject: a })).token;
    tokenB = (await tokens.issue({ subject: b })).token;
    const create = new CreateVehicleUseCase(repository);
    first = await create.execute(a, {
      make: 'Toyota',
      model: 'Camry',
      plateNumber: 'FIRST01',
      productionYear: 2024,
      color: 'Black',
    });
    second = await create.execute(a, { make: 'Toyota', model: 'Corolla', plateNumber: 'SECOND01' });
    foreign = await create.execute(b, { make: 'Honda', model: 'Civic', plateNumber: 'FOREIGN01' });
  });
  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: { in: fixtureOwners } } });
    expect(await prisma.user.count({ where: { id: { in: fixtureOwners } } })).toBe(0);
    expect(await prisma.vehicle.count({ where: { ownerUserId: { in: fixtureOwners } } })).toBe(0);
    expect(await prisma.refreshSession.count({ where: { userId: { in: fixtureOwners } } })).toBe(0);
    fixtureOwners.length = 0;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('atomically updates an owned row, preserves omitted values and createdAt, and changes updatedAt', async () => {
    const old = new Date('2020-01-01T00:00:00Z');
    await prisma.vehicle.updateMany({
      where: { id: first.id, ownerUserId: ownerA },
      data: { updatedAt: old },
    });
    const result = await repository.updateOwnedVehicle(ownerA, first.id, { model: 'Hybrid' });
    expect(result).toMatchObject({ ...first, model: 'Hybrid', updatedAt: expect.any(Date) });
    expect(result?.updatedAt.getTime()).toBeGreaterThan(old.getTime());
    expect(result?.createdAt).toEqual(first.createdAt);
    expect(result).not.toHaveProperty('ownerUserId');
    expect(await repository.listByOwner(ownerB)).toEqual([foreign]);
  });
  it('persists canonical plates and clears nullable fields without changing ownership', async () => {
    const result = await update.execute(ownerA, first.id, {
      plateNumber: '１２３－ａｂｃ－０１',
      productionYear: null,
      color: ' ',
    });
    expect(result).toMatchObject({ plateNumber: '123ABC01', productionYear: null, color: null });
    expect(
      await prisma.vehicle.findUnique({
        where: { id: first.id },
        select: { ownerUserId: true, plateNumber: true, productionYear: true, color: true },
      }),
    ).toEqual({ ownerUserId: ownerA, plateNumber: '123ABC01', productionYear: null, color: null });
  });
  it('rejects equivalent same-owner duplicate updates and preserves both original rows', async () => {
    await expect(
      update.execute(ownerA, second.id, { plateNumber: 'first-01' }),
    ).rejects.toBeInstanceOf(VehicleAlreadyExistsError);
    expect(await repository.listByOwner(ownerA)).toEqual(expect.arrayContaining([first, second]));
    await expect(
      update.execute(ownerA, first.id, { plateNumber: 'first-01' }),
    ).resolves.toMatchObject({ plateNumber: 'FIRST01' });
  });
  it('allows the same canonical plate under different owners', async () => {
    await expect(
      update.execute(ownerB, foreign.id, { plateNumber: 'first 01' }),
    ).resolves.toMatchObject({ plateNumber: 'FIRST01' });
    expect(await prisma.vehicle.count({ where: { plateNumber: 'FIRST01' } })).toBe(2);
  });
  it('returns the same null/false for missing and foreign rows with no changes', async () => {
    for (const id of [first.id, randomUUID()]) {
      expect(
        await repository.updateOwnedVehicle(ownerB, id, { plateNumber: 'FOREIGN01' }),
      ).toBeNull();
      expect(await repository.deleteOwnedVehicle(ownerB, id)).toBe(false);
    }
    expect(await repository.listByOwner(ownerA)).toEqual(expect.arrayContaining([first, second]));
    expect(await repository.listByOwner(ownerB)).toEqual([foreign]);
  });
  it('deletes exactly one owned row without changing another vehicle, its owner or sessions', async () => {
    const sessionProjection = { id: true, userId: true, revokedAt: true, updatedAt: true } as const;
    const sessions = await prisma.refreshSession.findMany({
      select: sessionProjection,
      orderBy: { id: 'asc' },
    });
    expect(sessions).toHaveLength(2);
    expect(await repository.deleteOwnedVehicle(ownerA, first.id)).toBe(true);
    expect(await repository.deleteOwnedVehicle(ownerA, first.id)).toBe(false);
    expect(await repository.listByOwner(ownerA)).toEqual([second]);
    expect(await repository.listByOwner(ownerB)).toEqual([foreign]);
    expect(await prisma.user.count({ where: { id: { in: fixtureOwners } } })).toBe(2);
    expect(
      await prisma.refreshSession.findMany({ select: sessionProjection, orderBy: { id: 'asc' } }),
    ).toEqual(sessions);
  });
  it('returns identical HTTP 404 errors for a foreign and a missing vehicle', async () => {
    for (const method of ['patch', 'delete'] as const) {
      for (const id of [first.id, randomUUID()]) {
        const response = await http(method, `/api/v1/vehicles/${id}`)
          .set('Authorization', `Bearer ${tokenB}`)
          .send({ model: 'Unauthorized' })
          .expect(404);
        expect(response.body.error).toEqual({
          code: 'VEHICLE_NOT_FOUND',
          message: 'The vehicle was not found',
        });
      }
    }
    expect(await repository.listByOwner(ownerA)).toEqual(expect.arrayContaining([first, second]));
  });
  it('serializes concurrent equivalent plate-changing HTTP requests into exactly 200 and 409', async () => {
    const responses = await Promise.all(
      [first, second].map((vehicle, index) =>
        request(app.getHttpServer())
          .patch(`/api/v1/vehicles/${vehicle.id}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ plateNumber: index ? 'race-123' : 'RACE 123' }),
      ),
    );
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(responses.find(({ status }) => status === 409)?.body.error.code).toBe(
      'VEHICLE_ALREADY_EXISTS',
    );
    expect(
      await prisma.vehicle.count({ where: { ownerUserId: ownerA, plateNumber: 'RACE123' } }),
    ).toBe(1);
    expect(await prisma.vehicle.count({ where: { ownerUserId: ownerA } })).toBe(2);
    expect(await repository.listByOwner(ownerB)).toEqual([foreign]);
  });
  it('serializes two concurrent deletes into exactly 204 and generic 404', async () => {
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .delete(`/api/v1/vehicles/${first.id}`)
          .set('Authorization', `Bearer ${tokenA}`),
      ),
    );
    expect(responses.map(({ status }) => status).sort()).toEqual([204, 404]);
    expect(responses.find(({ status }) => status === 204)?.text).toBe('');
    expect(responses.find(({ status }) => status === 404)?.body.error.code).toBe(
      'VEHICLE_NOT_FOUND',
    );
    expect(await repository.listByOwner(ownerA)).toEqual([second]);
    expect(await repository.listByOwner(ownerB)).toEqual([foreign]);
  });
  it('never recreates a vehicle in an update/delete race or touches unrelated rows', async () => {
    const [patch, deletion] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/api/v1/vehicles/${first.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ model: 'Race updated' }),
      request(app.getHttpServer())
        .delete(`/api/v1/vehicles/${first.id}`)
        .set('Authorization', `Bearer ${tokenA}`),
    ]);
    expect([200, 404]).toContain(patch.status);
    expect(deletion.status).toBe(204);
    expect(await prisma.vehicle.count({ where: { id: first.id } })).toBe(0);
    expect(await repository.listByOwner(ownerA)).toEqual([second]);
    expect(await repository.listByOwner(ownerB)).toEqual([foreign]);
  });
  it('retains the existing user deletion cascade', async () => {
    await prisma.user.delete({ where: { id: ownerA } });
    expect(await repository.listByOwner(ownerA)).toEqual([]);
    expect(await repository.listByOwner(ownerB)).toEqual([foreign]);
    expect(await repository.updateOwnedVehicle(ownerA, first.id, { model: 'X' })).toBeNull();
  });
});
