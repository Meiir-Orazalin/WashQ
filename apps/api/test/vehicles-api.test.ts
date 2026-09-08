import { Logger, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  createVehicleResponseSchema,
  updateVehicleResponseSchema,
  vehicleListResponseSchema,
} from '@washqueue/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JoseAccessTokenService } from '../src/auth/infrastructure/jose-access-token.service.js';
import type { UserRepository } from '../src/users/application/user-repository.js';
import {
  VehicleAlreadyExistsError,
  type VehicleRepository,
} from '../src/vehicles/application/vehicle.repository.js';
import { createVehicleTestApp } from './vehicle-test-app.js';

const owner = 'df4e7850-e329-4679-91f1-77b409d93f4f';
const input = { make: 'Toyota', model: 'Camry', plateNumber: '123 ABC 01' };
const vehicle = {
  id: '00000000-0000-4000-8000-000000000001',
  ...input,
  plateNumber: '123ABC01',
  productionYear: null,
  color: null,
  createdAt: new Date('2026-09-07T10:00:00Z'),
  updatedAt: new Date('2026-09-07T10:00:00Z'),
};
const generic401 = { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required' };

describe('vehicle HTTP authentication and contracts', () => {
  let app: INestApplication;
  let repository: VehicleRepository;
  let users: UserRepository;
  let now: Date;
  let token: string;
  const http = (method: 'patch' | 'delete', path: string) =>
    request(app.getHttpServer())[method](path);
  beforeEach(async () => {
    now = new Date('2026-09-07T10:00:00Z');
    const tokens = new JoseAccessTokenService({
      signingSecret: 's'.repeat(48),
      lifetimeSeconds: 900,
      now: () => now,
    });
    token = (await tokens.issue({ subject: owner })).token;
    repository = {
      updateOwnedVehicle: vi.fn().mockResolvedValue(vehicle),
      deleteOwnedVehicle: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockResolvedValue(vehicle),
      listByOwner: vi.fn().mockResolvedValue([vehicle]),
    };
    users = {
      create: vi.fn(),
      findAuthenticationByEmail: vi.fn(),
      findPublicById: vi.fn().mockResolvedValue({
        id: owner,
        firstName: 'Customer',
        lastName: null,
        email: 'vehicle-api@example.invalid',
      }),
    };
    app = await createVehicleTestApp(repository, users, tokens);
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  const authenticated = (app: INestApplication, token: string) =>
    request(app.getHttpServer()).get('/api/v1/vehicles').set('Authorization', `Bearer ${token}`);

  it('updates with 200 using only the principal and returns a strict public vehicle', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/vehicles/${vehicle.id}?ownerUserId=ignored`)
      .set('Authorization', `Bearer ${token}`)
      .send({ model: ' Camry  Hybrid ', color: null })
      .expect(200);
    expect(updateVehicleResponseSchema.safeParse(response.body).success).toBe(true);
    expect(repository.updateOwnedVehicle).toHaveBeenCalledExactlyOnceWith(owner, vehicle.id, {
      model: 'Camry Hybrid',
      color: null,
    });
    expect(response.headers['set-cookie']).toBeUndefined();
  });
  it('deletes with a zero-byte 204 and no JSON contract or cookie', async () => {
    const response = await request(app.getHttpServer())
      .delete(`/api/v1/vehicles/${vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    expect(Buffer.byteLength(response.text)).toBe(0);
    expect(response.headers['content-type']).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(repository.deleteOwnedVehicle).toHaveBeenCalledExactlyOnceWith(owner, vehicle.id);
  });
  it.each(['patch', 'delete'] as const)(
    'rejects invalid %s UUID before persistence',
    async (method) => {
      await http(method, '/api/v1/vehicles/invalid')
        .set('Authorization', `Bearer ${token}`)
        .send({ model: 'Hybrid' })
        .expect(400);
      expect(repository.updateOwnedVehicle).not.toHaveBeenCalled();
      expect(repository.deleteOwnedVehicle).not.toHaveBeenCalled();
    },
  );
  it.each([
    {},
    { ownerUserId: owner },
    { userId: owner },
    { id: owner },
    { createdAt: '2026-01-01T00:00:00Z' },
    { updatedAt: '2026-01-01T00:00:00Z' },
    { passwordHash: 'rejected' },
  ])('rejects empty or immutable PATCH input', async (patch) => {
    await request(app.getHttpServer())
      .patch(`/api/v1/vehicles/${vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(patch)
      .expect(400);
    expect(repository.updateOwnedVehicle).not.toHaveBeenCalled();
  });
  it.each(['patch', 'delete'] as const)(
    'conflates foreign and missing %s results',
    async (method) => {
      vi.mocked(repository.updateOwnedVehicle).mockResolvedValue(null);
      vi.mocked(repository.deleteOwnedVehicle).mockResolvedValue(false);
      for (const id of [vehicle.id, '00000000-0000-4000-8000-000000000099']) {
        const response = await http(method, `/api/v1/vehicles/${id}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ model: 'Hybrid' })
          .expect(404);
        expect(response.body.error).toEqual({
          code: 'VEHICLE_NOT_FOUND',
          message: 'The vehicle was not found',
        });
      }
    },
  );
  it('maps canonical duplicate updates to controlled 409', async () => {
    vi.mocked(repository.updateOwnedVehicle).mockRejectedValue(new VehicleAlreadyExistsError());
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/vehicles/${vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ plateNumber: '123-abc-01' })
      .expect(409);
    expect(repository.updateOwnedVehicle).toHaveBeenCalledExactlyOnceWith(owner, vehicle.id, {
      plateNumber: '123ABC01',
    });
    expect(response.body.error).toEqual({
      code: 'VEHICLE_ALREADY_EXISTS',
      message: 'A vehicle with this plate already exists',
    });
  });
  it.each(['patch', 'delete'] as const)(
    'sanitizes unexpected %s failures and never logs credentials or ownership',
    async (method) => {
      const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const failure = new Error(
        `private-database-detail ${token} ${owner} ${'s'.repeat(48)} private-password-marker`,
      );
      vi.mocked(repository.updateOwnedVehicle).mockRejectedValue(failure);
      vi.mocked(repository.deleteOwnedVehicle).mockRejectedValue(failure);
      const response = await http(method, `/api/v1/vehicles/${vehicle.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ model: 'Hybrid' })
        .expect(500);
      expect(response.body.error).toEqual({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      });
      const output = JSON.stringify([response.body.error, spy.mock.calls]);
      expect(
        [token, owner, 's'.repeat(48), 'private-password-marker', 'private-database-detail'].some(
          (secret) => output.includes(secret),
        ),
      ).toBe(false);
      expect(output).not.toMatch(/Authorization|ownerUserId|constraint|P2002|stack/);
    },
  );

  it('creates 201 and lists 200 with strict public contracts and verified owner', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send(input)
      .expect(201);
    expect(createVehicleResponseSchema.safeParse(created.body).success).toBe(true);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: owner, plateNumber: '123ABC01' }),
    );
    const listed = await authenticated(app, token).expect(200);
    expect(vehicleListResponseSchema.safeParse(listed.body).success).toBe(true);
    expect(repository.listByOwner).toHaveBeenCalledExactlyOnceWith(owner);
    expect(created.headers['set-cookie']).toBeUndefined();
  });
  it.each(['', 'Basic invalid', 'Bearer malformed', 'Bearer one, Bearer two'])(
    'rejects missing/malformed credentials generically',
    async (authorization) => {
      for (const method of ['get', 'post', 'patch', 'delete'] as const) {
        const client = request(app.getHttpServer());
        const response = await client[method](
          `/api/v1/vehicles${method === 'patch' || method === 'delete' ? `/${vehicle.id}` : ''}`,
        )
          .set('Authorization', authorization)
          .send(input)
          .expect(401);
        expect(response.body.error).toEqual(generic401);
      }
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.listByOwner).not.toHaveBeenCalled();
      expect(repository.updateOwnedVehicle).not.toHaveBeenCalled();
      expect(repository.deleteOwnedVehicle).not.toHaveBeenCalled();
    },
  );
  it('returns generic 401 for expiration and deleted users', async () => {
    now = new Date('2026-09-07T10:15:01Z');
    expect((await authenticated(app, token).expect(401)).body.error).toEqual(generic401);
    for (const method of ['patch', 'delete'] as const)
      expect(
        (
          await http(method, `/api/v1/vehicles/${vehicle.id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ color: null })
            .expect(401)
        ).body.error,
      ).toEqual(generic401);
    now = new Date('2026-09-07T10:00:00Z');
    vi.mocked(users.findPublicById).mockResolvedValue(null);
    expect((await authenticated(app, token).expect(401)).body.error).toEqual(generic401);
    for (const method of ['patch', 'delete'] as const)
      expect(
        (
          await http(method, `/api/v1/vehicles/${vehicle.id}`)
            .set('Authorization', `Bearer ${token}`)
            .send({ color: null })
            .expect(401)
        ).body.error,
      ).toEqual(generic401);
  });
  it.each(['ownerUserId', 'userId', 'unknown', 'password', 'id'])(
    'rejects spoofed/unknown %s',
    async (field) => {
      await request(app.getHttpServer())
        .post('/api/v1/vehicles')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...input, [field]: 'not-accepted' })
        .expect(400);
      expect(repository.create).not.toHaveBeenCalled();
    },
  );
  it('maps duplicate to a stable sanitized 409', async () => {
    vi.mocked(repository.create).mockRejectedValue(new VehicleAlreadyExistsError());
    const response = await request(app.getHttpServer())
      .post('/api/v1/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .send(input)
      .expect(409);
    expect(response.body.error).toEqual({
      code: 'VEHICLE_ALREADY_EXISTS',
      message: 'A vehicle with this plate already exists',
    });
  });
  it.each(['create', 'list', 'authentication'])(
    'sanitizes %s infrastructure failures and logs no credentials',
    async (boundary) => {
      const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const failure = new Error(
        `private-database-detail ${token} ${'s'.repeat(48)} private-password-marker`,
      );
      if (boundary === 'create') vi.mocked(repository.create).mockRejectedValue(failure);
      else if (boundary === 'list') vi.mocked(repository.listByOwner).mockRejectedValue(failure);
      else vi.mocked(users.findPublicById).mockRejectedValue(failure);
      const response =
        boundary === 'create'
          ? await request(app.getHttpServer())
              .post('/api/v1/vehicles')
              .set('Authorization', `Bearer ${token}`)
              .send(input)
              .expect(500)
          : await authenticated(app, token).expect(500);
      expect(response.body.error).toEqual({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      });
      const serialized = JSON.stringify([response.body, spy.mock.calls]);
      expect(
        [token, 's'.repeat(48), 'private-password-marker', 'private-database-detail'].some(
          (secret) => serialized.includes(secret),
        ),
      ).toBe(false);
      expect(serialized).not.toMatch(/Authorization|constraint|P2002|stack/);
    },
  );
  it('does not install a global guard and leaves public routes public', async () => {
    await request(app.getHttpServer()).get('/api/v1/public-test').expect(200);
    expect(users.findPublicById).not.toHaveBeenCalled();
  });
  it('documents scoped Bearer security, public responses and expected error statuses', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'access-token')
        .build(),
    );
    const routes = document.paths['/api/v1/vehicles'];
    const mutationRoutes = document.paths['/api/v1/vehicles/{vehicleId}'];
    for (const method of ['patch', 'delete'] as const) {
      expect(mutationRoutes?.[method]?.security).toEqual([{ 'access-token': [] }]);
      expect(mutationRoutes?.[method]?.parameters).toContainEqual(
        expect.objectContaining({
          name: 'vehicleId',
          required: true,
          in: 'path',
          schema: expect.objectContaining({ format: 'uuid' }),
        }),
      );
      for (const status of ['400', '401', '404', '500'])
        expect(mutationRoutes?.[method]?.responses).toHaveProperty(status);
    }
    for (const status of ['200', '409'])
      expect(mutationRoutes?.patch?.responses).toHaveProperty(status);
    expect(mutationRoutes?.delete?.responses['204']).not.toHaveProperty('content');
    expect(routes?.get?.security).toEqual([{ 'access-token': [] }]);
    expect(routes?.post?.security).toEqual([{ 'access-token': [] }]);
    for (const status of ['201', '400', '401', '409', '500'])
      expect(routes?.post?.responses).toHaveProperty(status);
    for (const status of ['200', '401', '500'])
      expect(routes?.get?.responses).toHaveProperty(status);
    expect(document.paths['/api/v1/public-test']?.get?.security).toBeUndefined();
    const publicSchema = document.components?.schemas?.['PublicVehicleDto'];
    expect(
      publicSchema && 'properties' in publicSchema ? publicSchema.properties : undefined,
    ).not.toHaveProperty('ownerUserId');
  });
});
