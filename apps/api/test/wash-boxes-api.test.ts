import { Logger, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { washBoxResponseSchema, washBoxListResponseSchema } from '@washqueue/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JoseAccessTokenService } from '../src/auth/infrastructure/jose-access-token.service.js';
import type { UserRepository } from '../src/users/application/user-repository.js';
import type { OrganizationRepository } from '../src/organizations/application/organization.repository.js';
import type { BranchRepository } from '../src/branches/application/branch.repository.js';
import {
  WashBoxAlreadyExistsError,
  type WashBoxRepository,
} from '../src/wash-boxes/application/wash-box.repository.js';
import { createOrganizationTestApp } from './organization-test-app.js';
const userId = '00000000-0000-4000-8000-000000000001';
const orgId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const boxId = '00000000-0000-4000-8000-000000000004';
const box = { id: boxId, number: 1, isActive: false, createdAt: new Date(), updatedAt: new Date() };
const base = `/api/v1/organizations/${orgId}/branches/${branchId}/wash-boxes`;
const endpoints = [
  ['post', base, { number: 1 }],
  ['get', base, undefined],
  ['get', `${base}/${boxId}`, undefined],
  ['patch', `${base}/${boxId}`, { isActive: false }],
] as const;
describe('wash box HTTP production composition', () => {
  let app: INestApplication;
  let token: string;
  let now: Date;
  let boxes: WashBoxRepository;
  let users: UserRepository;
  let organizations: OrganizationRepository;
  let branches: BranchRepository;
  beforeEach(async () => {
    now = new Date();
    const tokens = new JoseAccessTokenService({
      signingSecret: 's'.repeat(48),
      lifetimeSeconds: 900,
      now: () => now,
    });
    token = (await tokens.issue({ subject: userId })).token;
    users = {
      create: vi.fn(),
      findAuthenticationByEmail: vi.fn(),
      findPublicById: vi.fn().mockResolvedValue({
        id: userId,
        firstName: 'Owner',
        lastName: null,
        email: 'owner@example.invalid',
      }),
      updateCurrentUserProfile: vi.fn(),
    };
    organizations = {
      createWithOwnerMembership: vi.fn(),
      listOwnedByUser: vi.fn(),
      findOwnedById: vi.fn().mockResolvedValue({ id: orgId }),
    };
    branches = {
      createBranch: vi.fn(),
      listBranchesByOrganization: vi.fn(),
      replaceOpeningHours: vi.fn(),
      findBranchByOrganizationAndId: vi.fn().mockResolvedValue({ id: branchId }),
    };
    boxes = {
      create: vi.fn().mockResolvedValue({ ...box, isActive: true }),
      listByBranch: vi.fn().mockResolvedValue([box]),
      findByBranchAndId: vi.fn().mockResolvedValue(box),
      setActiveState: vi.fn().mockResolvedValue(box),
    };
    app = await createOrganizationTestApp(users, tokens, organizations, branches, boxes);
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  const call = (method: 'post' | 'get' | 'patch', path: string) =>
    request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
  it('strict 201/200 responses, inactive list/detail, explicit repeated PATCH and no cookies/ownership', async () => {
    for (const [method, path, input] of endpoints) {
      const response = await call(method, path)
        .send(input)
        .expect(method === 'post' ? 201 : 200);
      expect(
        (path === base && method === 'get'
          ? washBoxListResponseSchema
          : washBoxResponseSchema
        ).safeParse(response.body).success,
      ).toBe(true);
      expect(JSON.stringify(response.body)).not.toMatch(
        /branchId|organizationId|userId|membership|password|token/,
      );
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    await call('patch', `${base}/${boxId}`).send({ isActive: false }).expect(200);
    expect(boxes.setActiveState).toHaveBeenCalledWith(branchId, boxId, false);
  });
  for (const [method, path, input] of endpoints) {
    for (const state of ['missing', 'malformed', 'expired', 'deleted'])
      it(`${method} generic 401 ${state}`, async () => {
        if (state === 'expired') now = new Date(now.getTime() + 901000);
        if (state === 'deleted') vi.mocked(users.findPublicById).mockResolvedValue(null);
        let pending = request(app.getHttpServer())[method](path);
        if (state !== 'missing')
          pending = pending.set(
            'Authorization',
            state === 'malformed' ? 'invalid' : `Bearer ${token}`,
          );
        expect((await pending.send(input).expect(401)).body.error).toEqual({
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required',
        });
        expect(organizations.findOwnedById).not.toHaveBeenCalled();
        for (const operation of Object.values(boxes)) expect(operation).not.toHaveBeenCalled();
      });
    it(`${method} missing/nonowned organization stops branch and box access`, async () => {
      vi.mocked(organizations.findOwnedById).mockResolvedValue(null);
      expect((await call(method, path).send(input).expect(404)).body.error).toEqual({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'The organization was not found',
      });
      expect(branches.findBranchByOrganizationAndId).not.toHaveBeenCalled();
      for (const operation of Object.values(boxes)) expect(operation).not.toHaveBeenCalled();
    });
    it(`${method} missing/wrong organization branch stops box access`, async () => {
      vi.mocked(branches.findBranchByOrganizationAndId).mockResolvedValue(null);
      expect((await call(method, path).send(input).expect(404)).body.error).toEqual({
        code: 'BRANCH_NOT_FOUND',
        message: 'The branch was not found',
      });
      for (const operation of Object.values(boxes)) expect(operation).not.toHaveBeenCalled();
    });
  }
  it.each(['get', 'patch'] as const)(
    '%s missing/wrong branch box uses identical 404',
    async (method) => {
      vi.mocked(boxes.findByBranchAndId).mockResolvedValue(null);
      vi.mocked(boxes.setActiveState).mockResolvedValue(null);
      expect(
        (
          await call(method, `${base}/${boxId}`)
            .send(method === 'patch' ? { isActive: true } : undefined)
            .expect(404)
        ).body.error,
      ).toEqual({ code: 'WASH_BOX_NOT_FOUND', message: 'The wash box was not found' });
    },
  );
  it('controlled duplicate maps only to stable 409', async () => {
    vi.mocked(boxes.create).mockRejectedValue(new WashBoxAlreadyExistsError());
    expect((await call('post', base).send({ number: 1 }).expect(409)).body.error.code).toBe(
      'WASH_BOX_ALREADY_EXISTS',
    );
  });
  it.each([
    {},
    { number: '1' },
    { number: 0 },
    { number: 1.1 },
    { number: 1000 },
    { number: 1, isActive: false },
    { number: 1, branchId },
    { number: 1, ownerUserId: userId },
  ])('rejects strict creation data', async (input) => {
    await call('post', base).send(input).expect(400);
    expect(boxes.create).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { isActive: 'false' },
    { isActive: null },
    { isActive: 0 },
    { isActive: false, number: 2 },
    { isActive: true, organizationId: orgId },
    { isActive: true, userId },
  ])('rejects strict state data', async (input) => {
    await call('patch', `${base}/${boxId}`).send(input).expect(400);
    expect(boxes.setActiveState).not.toHaveBeenCalled();
  });
  it('rejects UUIDs and unknown query before application persistence', async () => {
    for (const id of [orgId, branchId, boxId])
      await call('get', `${base}/${boxId}`.replace(id, 'invalid')).expect(400);
    await call('get', base + '?userId=untrusted').expect(400);
    expect(boxes.listByBranch).not.toHaveBeenCalled();
  });
  it('unexpected failures are sanitized and logs contain no credentials or ownership', async () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.mocked(boxes.create).mockRejectedValue(new Error('private database constraint detail'));
    const response = await call('post', base).send({ number: 1 }).expect(500);
    expect(response.body.error).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
    const serialized = JSON.stringify([response.body, log.mock.calls]);
    expect(
      [token, userId, 'private database constraint detail', 'Authorization'].some((value) =>
        serialized.includes(value),
      ),
    ).toBe(false);
  });
  it('OpenAPI documents all four protected routes with strict fields and public health remains public', async () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, 'access-token').build(),
    );
    const path = '/api/v1/organizations/{organizationId}/branches/{branchId}/wash-boxes';
    for (const [suffix, method] of [
      ['', 'post'],
      ['', 'get'],
      ['/{washBoxId}', 'get'],
      ['/{washBoxId}', 'patch'],
    ] as const) {
      const operation = document.paths[path + suffix]?.[method];
      expect(operation?.security).toEqual([{ 'access-token': [] }]);
      for (const status of ['400', '401', '404', '500'])
        expect(operation?.responses).toHaveProperty(status);
    }
    expect(document.paths[path]?.post?.responses).toHaveProperty('409');
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });
});
