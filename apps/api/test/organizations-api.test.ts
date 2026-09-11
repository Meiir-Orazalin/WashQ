import { Logger, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  createOrganizationResponseSchema,
  organizationListResponseSchema,
  organizationDetailResponseSchema,
} from '@washqueue/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JoseAccessTokenService } from '../src/auth/infrastructure/jose-access-token.service.js';
import type { UserRepository } from '../src/users/application/user-repository.js';
import type { OrganizationRepository } from '../src/organizations/application/organization.repository.js';
import { createOrganizationTestApp } from './organization-test-app.js';

const user = {
  id: '10abed8b-ed56-4744-90ae-48e9c75fab37',
  firstName: 'Owner',
  lastName: null,
  email: 'owner@example.invalid',
};
const organization = {
  id: 'de33c359-79fb-482a-9034-00b63d1c9024',
  name: 'Wash',
  description: null,
  createdAt: new Date('2026-09-11T00:00:00Z'),
  updatedAt: new Date('2026-09-11T00:00:00Z'),
};
const base = '/api/v1/organizations';
const generic401 = { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required' };
describe('organization HTTP and production module composition', () => {
  let app: INestApplication;
  let users: UserRepository;
  let organizations: OrganizationRepository;
  let token: string;
  let now: Date;
  beforeEach(async () => {
    now = new Date('2026-09-11T00:00:00Z');
    const tokens = new JoseAccessTokenService({
      signingSecret: 's'.repeat(48),
      lifetimeSeconds: 900,
      now: () => now,
    });
    token = (await tokens.issue({ subject: user.id })).token;
    users = {
      create: vi.fn(),
      findAuthenticationByEmail: vi.fn(),
      findPublicById: vi.fn().mockResolvedValue(user),
      updateCurrentUserProfile: vi.fn(),
    };
    organizations = {
      createWithOwnerMembership: vi.fn().mockResolvedValue(organization),
      listOwnedByUser: vi.fn().mockResolvedValue([organization]),
      findOwnedById: vi.fn().mockResolvedValue(organization),
    };
    app = await createOrganizationTestApp(users, tokens, organizations);
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  const call = (method: 'get' | 'post', path = base) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
  it('creates with normalized values, trusted owner, strict 201 and no cookie', async () => {
    const result = await call('post').send({ name: ' Ｗash ', description: ' ' }).expect(201);
    expect(createOrganizationResponseSchema.safeParse(result.body).success).toBe(true);
    expect(organizations.createWithOwnerMembership).toHaveBeenCalledExactlyOnceWith(user.id, {
      name: 'Wash',
      description: null,
    });
    expect(result.headers['set-cookie']).toBeUndefined();
  });
  it('lists and reads details through owner-scoped ports and strict 200', async () => {
    const list = await call('get').expect(200);
    const detail = await call('get', `${base}/${organization.id}`).expect(200);
    expect(organizationListResponseSchema.safeParse(list.body).success).toBe(true);
    expect(organizationDetailResponseSchema.safeParse(detail.body).success).toBe(true);
    expect(organizations.listOwnedByUser).toHaveBeenCalledExactlyOnceWith(user.id);
    expect(organizations.findOwnedById).toHaveBeenCalledExactlyOnceWith(user.id, organization.id);
    expect(JSON.stringify([list.body, detail.body]).includes(user.id)).toBe(false);
  });
  it.each([
    {},
    { name: '' },
    { name: 'A' },
    { name: null },
    { name: 'Wash\n' },
    { name: 'Wash', description: '\u0000' },
  ])('rejects invalid input %#', async (input) => {
    await call('post').send(input).expect(400);
    expect(organizations.createWithOwnerMembership).not.toHaveBeenCalled();
  });
  it.each([
    'userId',
    'ownerUserId',
    'membershipRole',
    'membershipId',
    'memberships',
    'roles',
    'permissions',
    'password',
    'token',
    'id',
  ])('rejects spoofed %s', async (field) => {
    await call('post')
      .send({ name: 'Wash', [field]: 'untrusted' })
      .expect(400);
    await call('get')
      .query({ [field]: 'untrusted' })
      .expect(400);
    await call('get', `${base}/${organization.id}`)
      .query({ [field]: 'untrusted' })
      .expect(400);
    expect(organizations.createWithOwnerMembership).not.toHaveBeenCalled();
    expect(organizations.listOwnedByUser).not.toHaveBeenCalled();
    expect(organizations.findOwnedById).not.toHaveBeenCalled();
  });
  it('rejects invalid UUID before the organization repository', async () => {
    await call('get', `${base}/bad`).expect(400);
    expect(organizations.findOwnedById).not.toHaveBeenCalled();
  });
  it.each([400, 500])(
    'does not reflect or log rejected ownership query values on %i',
    async (status) => {
      const logs = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      if (status === 500)
        vi.mocked(users.findPublicById).mockRejectedValue(new Error('unavailable'));
      const result = await call('get')
        .query({ userId: user.id, token: 'private-query-marker' })
        .expect(status);
      expect(result.body.path).toBe(base);
      const serialized = JSON.stringify([result.body, logs.mock.calls]);
      expect(
        [user.id, 'private-query-marker', token].some((value) => serialized.includes(value)),
      ).toBe(false);
    },
  );
  it.each(['missing', 'malformed', 'invalid', 'expired', 'deleted'])(
    'has identical generic 401 for %s on every protected route',
    async (kind) => {
      if (kind === 'expired') now = new Date(now.getTime() + 901_000);
      if (kind === 'deleted') vi.mocked(users.findPublicById).mockResolvedValue(null);
      for (const [method, path] of [
        ['post', base],
        ['get', base],
        ['get', `${base}/${organization.id}`],
      ] as const) {
        const pending = request(app.getHttpServer())[method](path);
        if (kind !== 'missing')
          pending.set(
            'Authorization',
            kind === 'malformed'
              ? 'Basic invalid'
              : `Bearer ${kind === 'invalid' ? 'invalid' : token}`,
          );
        const result = await pending
          .send(method === 'post' ? { name: 'Wash' } : undefined)
          .expect(401);
        expect(result.body.error).toEqual(generic401);
      }
    },
  );
  it('returns indistinguishable controlled foreign/missing 404 errors', async () => {
    vi.mocked(organizations.findOwnedById).mockResolvedValue(null);
    const foreign = await call('get', `${base}/${organization.id}`).expect(404);
    const missing = await call('get', `${base}/11111111-1111-4111-8111-111111111111`).expect(404);
    expect(foreign.body.error).toEqual(missing.body.error);
    expect(foreign.body.error).toEqual({
      code: 'ORGANIZATION_NOT_FOUND',
      message: 'The organization was not found',
    });
  });
  it.each(['create', 'list', 'detail', 'identity'])(
    'sanitizes %s failures and excludes credentials and ownership from logs',
    async (stage) => {
      const logs = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const target =
        stage === 'create'
          ? organizations.createWithOwnerMembership
          : stage === 'list'
            ? organizations.listOwnedByUser
            : stage === 'detail'
              ? organizations.findOwnedById
              : users.findPublicById;
      vi.mocked(target).mockRejectedValue(new Error('private database constraint details'));
      const result = await call(
        stage === 'create' ? 'post' : 'get',
        stage === 'detail' ? `${base}/${organization.id}` : base,
      )
        .send(stage === 'create' ? { name: 'PrivateOrganization' } : undefined)
        .expect(500);
      expect(result.body.error).toEqual({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      });
      const serialized = JSON.stringify([result.body, logs.mock.calls]);
      expect(
        [
          token,
          's'.repeat(48),
          user.id,
          'PrivateOrganization',
          'private database constraint details',
          'Authorization',
          'membership',
        ].some((value) => serialized.includes(value)),
      ).toBe(false);
    },
  );
  it('leaves health and public auth routes unguarded', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    for (const path of ['register', 'login'])
      await request(app.getHttpServer()).post(`/api/v1/auth/${path}`).send({}).expect(400);
    await request(app.getHttpServer()).post('/api/v1/auth/logout').expect(204);
    const refresh = await request(app.getHttpServer()).post('/api/v1/auth/refresh').expect(401);
    expect(refresh.body.error.code).toBe('INVALID_REFRESH_SESSION');
  });
  it('documents strict schemas, scoped Bearer security, UUID and sanitized errors', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, 'access-token').build(),
    );
    const paths = document.paths;
    for (const operation of [
      paths[base]?.post,
      paths[base]?.get,
      paths[`${base}/{organizationId}`]?.get,
    ]) {
      expect(operation?.security).toEqual([{ 'access-token': [] }]);
      for (const code of ['400', '401', '500']) expect(operation?.responses[code]).toBeDefined();
    }
    expect(paths[`${base}/{organizationId}`]?.get?.responses['404']).toBeDefined();
    expect(JSON.stringify(paths[base]?.post?.requestBody)).toContain(
      '"additionalProperties":false',
    );
    expect(JSON.stringify(paths[base]?.post?.responses['201'])).toContain(
      '"additionalProperties":false',
    );
    expect(paths['/api/v1/health']?.get?.security).toBeUndefined();
  });
});
