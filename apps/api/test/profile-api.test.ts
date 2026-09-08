import { Logger, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { currentUserResponseSchema } from '@washqueue/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JoseAccessTokenService } from '../src/auth/infrastructure/jose-access-token.service.js';
import type { UserRepository } from '../src/users/application/user-repository.js';
import { createProfileTestApp } from './profile-test-app.js';

const user = {
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Current',
  lastName: null,
  email: 'profile@example.invalid',
};
const generic401 = { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required' };
describe('profile HTTP and production composition', () => {
  let app: INestApplication;
  let users: UserRepository;
  let token: string;
  let now: Date;
  beforeEach(async () => {
    now = new Date('2026-09-08T10:00:00Z');
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
      updateCurrentUserProfile: vi.fn().mockResolvedValue(user),
    };
    app = await createProfileTestApp(users, tokens);
  });
  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });
  const patch = () =>
    request(app.getHttpServer()).patch('/api/v1/users/me').set('Authorization', `Bearer ${token}`);

  it('updates with strict public 200, normalized names, principal-only identity and no cookie', async () => {
    const result = await patch().send({ firstName: ' Current ', lastName: ' ' }).expect(200);
    expect(currentUserResponseSchema.safeParse(result.body).success).toBe(true);
    expect(users.updateCurrentUserProfile).toHaveBeenCalledExactlyOnceWith(user.id, {
      firstName: 'Current',
      lastName: null,
    });
    expect(result.headers['set-cookie']).toBeUndefined();
    expect(Object.keys(result.body.user).sort()).toEqual(['email', 'firstName', 'id', 'lastName']);
  });
  it.each([{}, { firstName: null }, { firstName: 'A' }, { lastName: 'A' }, { firstName: 2 }])(
    'rejects empty or invalid names %#',
    async (input) => {
      await patch().send(input).expect(400);
      expect(users.updateCurrentUserProfile).not.toHaveBeenCalled();
    },
  );
  it.each([
    'id',
    'userId',
    'ownerUserId',
    'email',
    'password',
    'passwordHash',
    'roles',
    'permissions',
    'organizationId',
    'token',
    'sessions',
    'createdAt',
    'updatedAt',
  ])('rejects immutable/spoof field %s', async (field) => {
    await patch()
      .send({ firstName: 'Valid', [field]: 'untrusted' })
      .expect(400);
    expect(users.updateCurrentUserProfile).not.toHaveBeenCalled();
  });
  it.each(['userId', 'ownerUserId', 'id'])('rejects query identity %s', async (field) => {
    await patch()
      .query({ [field]: 'untrusted' })
      .send({ firstName: 'Valid' })
      .expect(400);
    expect(users.updateCurrentUserProfile).not.toHaveBeenCalled();
  });
  it.each(['missing', 'malformed', 'invalid', 'expired', 'deleted', 'race-deleted'])(
    'returns identical generic 401 for %s authentication',
    async (kind) => {
      if (kind === 'expired') now = new Date(now.getTime() + 901_000);
      if (kind === 'deleted') vi.mocked(users.findPublicById).mockResolvedValue(null);
      if (kind === 'race-deleted')
        vi.mocked(users.updateCurrentUserProfile).mockResolvedValue(null);
      const call = request(app.getHttpServer()).patch('/api/v1/users/me');
      if (kind !== 'missing')
        call.set(
          'Authorization',
          kind === 'malformed'
            ? 'Basic invalid'
            : `Bearer ${kind === 'invalid' ? 'invalid' : token}`,
        );
      const result = await call.send({ firstName: 'Updated' }).expect(401);
      expect(result.body.error).toEqual(generic401);
      expect(result.headers['set-cookie']).toBeUndefined();
    },
  );
  it.each(['lookup', 'update'])(
    'sanitizes unexpected %s failures and never logs credentials or profile fields',
    async (stage) => {
      const logs = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const privateMarker = 'private-profile-and-database-details';
      vi.mocked(
        stage === 'lookup' ? users.findPublicById : users.updateCurrentUserProfile,
      ).mockRejectedValue(new Error(privateMarker));
      const result = await patch()
        .send({ firstName: 'PrivateName', lastName: 'PrivateSurname' })
        .expect(500);
      expect(result.body.error).toEqual({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      });
      const serialized = JSON.stringify([logs.mock.calls, result.body]);
      expect(
        [
          token,
          's'.repeat(48),
          privateMarker,
          'PrivateName',
          'PrivateSurname',
          user.email,
          'Authorization',
          'passwordHash',
        ].some((value) => serialized.includes(value)),
      ).toBe(false);
    },
  );
  it('keeps existing auth/health public routes public and GET me unchanged', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    for (const path of ['register', 'login'])
      await request(app.getHttpServer()).post(`/api/v1/auth/${path}`).send({}).expect(400);
    await request(app.getHttpServer()).post('/api/v1/auth/logout').expect(204);
    const refresh = await request(app.getHttpServer()).post('/api/v1/auth/refresh').expect(401);
    expect(refresh.body.error.code).toBe('INVALID_REFRESH_SESSION');
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(currentUserResponseSchema.safeParse(me.body).success).toBe(true);
    expect(users.updateCurrentUserProfile).not.toHaveBeenCalled();
  });
  it('documents a Bearer-scoped strict partial request, reused response and only 200/400/401/500', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth(undefined, 'access-token').build(),
    );
    const endpoint = document.paths['/api/v1/users/me']?.patch;
    expect(endpoint?.security).toEqual([{ 'access-token': [] }]);
    expect(Object.keys(endpoint?.responses ?? {}).sort()).toEqual(['200', '400', '401', '500']);
    expect(endpoint?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: {
            minProperties: 1,
            additionalProperties: false,
            properties: { firstName: { type: 'string' }, lastName: { nullable: true } },
          },
        },
      },
    });
    expect(endpoint?.parameters).toEqual([]);
    expect(document.paths['/api/v1/auth/login']?.post?.security).toBeUndefined();
  });
});
