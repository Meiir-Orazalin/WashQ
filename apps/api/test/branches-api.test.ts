import { Logger, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  branchDetailResponseSchema,
  branchListResponseSchema,
  createBranchResponseSchema,
  openingHoursResponseSchema,
  weekdays,
} from '@washqueue/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JoseAccessTokenService } from '../src/auth/infrastructure/jose-access-token.service.js';
import type { UserRepository } from '../src/users/application/user-repository.js';
import type { OrganizationRepository } from '../src/organizations/application/organization.repository.js';
import type { BranchRepository } from '../src/branches/application/branch.repository.js';
import { createOrganizationTestApp } from './organization-test-app.js';
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  firstName: 'Owner',
  lastName: null,
  email: 'owner@example.invalid',
};
const organization = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Wash',
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const input = {
  name: 'Branch',
  city: 'Astana',
  addressLine: 'Address 12',
  timeZone: 'Asia/Almaty',
};
const branch = {
  id: '00000000-0000-4000-8000-000000000003',
  ...input,
  createdAt: new Date(),
  updatedAt: new Date(),
  openingHours: [],
};
const week = weekdays.map((dayOfWeek) => ({
  dayOfWeek,
  status: 'CLOSED',
  opensAt: null,
  closesAt: null,
  closesNextDay: false,
}));
const base = `/api/v1/organizations/${organization.id}/branches`;
const endpoints = [
  ['post', base, input],
  ['get', base, undefined],
  ['get', `${base}/${branch.id}`, undefined],
  ['put', `${base}/${branch.id}/opening-hours`, { openingHours: week }],
] as const;
describe('branch HTTP production composition', () => {
  let app: INestApplication;
  let branches: BranchRepository;
  let organizations: OrganizationRepository;
  let users: UserRepository;
  let token: string;
  let now: Date;
  beforeEach(async () => {
    now = new Date('2026-09-30T00:00:00Z');
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
      createWithOwnerMembership: vi.fn(),
      listOwnedByUser: vi.fn(),
      findOwnedById: vi.fn().mockResolvedValue(organization),
    };
    branches = {
      createBranch: vi.fn().mockResolvedValue(branch),
      listBranchesByOrganization: vi.fn().mockResolvedValue([branch]),
      findBranchByOrganizationAndId: vi.fn().mockResolvedValue(branch),
      replaceOpeningHours: vi
        .fn()
        .mockImplementation(
          async (_org, _id, hours: Parameters<BranchRepository['replaceOpeningHours']>[2]) => hours,
        ),
    };
    app = await createOrganizationTestApp(users, tokens, organizations, branches);
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  const call = (method: 'get' | 'post' | 'put', path: string) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
  it('POST/list/detail/PUT produce strict responses, canonical order and no cookies or internal fields', async () => {
    const created = await call('post', base)
      .send({ ...input, name: ' Ｂranch ' })
      .expect(201);
    const listed = await call('get', base).expect(200);
    const detail = await call('get', `${base}/${branch.id}`).expect(200);
    const hours = await call('put', `${base}/${branch.id}/opening-hours`)
      .send({ openingHours: [...week].reverse() })
      .expect(200);
    expect(createBranchResponseSchema.safeParse(created.body).success).toBe(true);
    expect(branchListResponseSchema.safeParse(listed.body).success).toBe(true);
    expect(branchDetailResponseSchema.safeParse(detail.body).success).toBe(true);
    expect(openingHoursResponseSchema.safeParse(hours.body).success).toBe(true);
    expect(branches.createBranch).toHaveBeenCalledWith(organization.id, input);
    expect(hours.body.openingHours).toEqual(week);
    for (const response of [created, listed, detail, hours]) {
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toMatch(
        /organizationId|userId|membership|opensAtMinute|closesAtMinute/,
      );
    }
  });
  for (const [method, path, body] of endpoints)
    for (const state of ['missing', 'malformed', 'expired', 'deleted'])
      it(`${method} ${path.split('/').at(-1)} generic 401 ${state}`, async () => {
        if (state === 'expired') now = new Date(now.getTime() + 901000);
        if (state === 'deleted') vi.mocked(users.findPublicById).mockResolvedValue(null);
        let pending = request(app.getHttpServer())[method](path);
        if (state !== 'missing')
          pending = pending.set(
            'Authorization',
            state === 'malformed' ? 'invalid' : `Bearer ${token}`,
          );
        const response = await pending.send(body).expect(401);
        expect(response.body.error).toEqual({
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required',
        });
        expect(organizations.findOwnedById).not.toHaveBeenCalled();
        for (const operation of Object.values(branches)) expect(operation).not.toHaveBeenCalled();
      });
  for (const [method, path, body] of endpoints)
    it(`${method} denies missing and foreign organization before branch persistence`, async () => {
      vi.mocked(organizations.findOwnedById).mockResolvedValue(null);
      const response = await call(method, path).send(body).expect(404);
      expect(response.body.error).toEqual({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'The organization was not found',
      });
      for (const operation of Object.values(branches)) expect(operation).not.toHaveBeenCalled();
    });
  for (const method of ['get', 'put'] as const)
    it(`${method} missing/wrong-organization branch has identical generic 404`, async () => {
      vi.mocked(branches.findBranchByOrganizationAndId).mockResolvedValue(null);
      vi.mocked(branches.replaceOpeningHours).mockResolvedValue(null);
      const response = await call(
        method,
        `${base}/${branch.id}${method === 'put' ? '/opening-hours' : ''}`,
      )
        .send(method === 'put' ? { openingHours: week } : undefined)
        .expect(404);
      expect(response.body.error).toEqual({
        code: 'BRANCH_NOT_FOUND',
        message: 'The branch was not found',
      });
    });
  for (const invalid of [
    { ...input, timeZone: '+05:00' },
    { ...input, userId: user.id },
    { ...input, organizationId: organization.id },
    { ...input, membershipRole: 'OWNER' },
    {},
  ])
    it('rejects invalid branch input and spoofing', async () => {
      await call('post', base).send(invalid).expect(400);
      expect(branches.createBranch).not.toHaveBeenCalled();
    });
  for (const invalid of [
    { openingHours: week.slice(1) },
    { openingHours: [...week.slice(0, 6), week[0]] },
    {
      openingHours: week.map((day) => ({
        ...day,
        status: 'OPEN',
        opensAt: '09:00',
        closesAt: '09:00',
      })),
    },
    { openingHours: week, userId: user.id },
  ])
    it('rejects invalid complete schedule without writes', async () => {
      await call('put', `${base}/${branch.id}/opening-hours`).send(invalid).expect(400);
      expect(branches.replaceOpeningHours).not.toHaveBeenCalled();
    });
  it('rejects invalid path UUIDs and query spoofing before persistence', async () => {
    await call('get', '/api/v1/organizations/bad/branches').expect(400);
    await call('get', `${base}/bad`).expect(400);
    await call('get', `${base}?userId=private`).expect(400);
    expect(organizations.findOwnedById).not.toHaveBeenCalled();
  });
  it('sanitizes failures/logs and does not log identity or credentials', async () => {
    const logs = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.mocked(branches.replaceOpeningHours).mockRejectedValue(
      new Error('private constraint password database'),
    );
    const response = await call('put', `${base}/${branch.id}/opening-hours`)
      .send({ openingHours: week })
      .expect(500);
    const serialized = JSON.stringify([response.body, logs.mock.calls]);
    expect(serialized.includes(token)).toBe(false);
    expect(serialized.includes(user.id)).toBe(false);
    expect(serialized).not.toMatch(/private constraint|Authorization|Bearer|password database/);
    expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
  });
  it('documents all four scoped routes and leaves public health unguarded', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, 'access-token').build(),
    );
    const paths = doc.paths;
    for (const [path, methods] of [
      ['/api/v1/organizations/{organizationId}/branches', ['post', 'get']],
      ['/api/v1/organizations/{organizationId}/branches/{branchId}', ['get']],
      ['/api/v1/organizations/{organizationId}/branches/{branchId}/opening-hours', ['put']],
    ] as const) {
      for (const method of methods) {
        const operation = paths[path]?.[method];
        expect(operation?.security).toEqual([{ 'access-token': [] }]);
        for (const status of ['400', '401', '404', '500'])
          expect(operation?.responses[status]).toBeDefined();
      }
    }
    expect(JSON.stringify(paths)).not.toMatch(/membershipId|opensAtMinute/);
  });
});
