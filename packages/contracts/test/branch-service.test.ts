import { describe, expect, it } from 'vitest';
import {
  createBranchServiceRequestSchema as create,
  updateBranchServiceRequestSchema as update,
  publicBranchServiceSchema as publicService,
  branchServiceResponseSchema,
  branchServiceListResponseSchema,
  branchServiceIdParamsSchema,
} from '../src/branch-service.js';
const input = { name: 'Exterior wash', durationMinutes: 30, priceMinor: 500000, currency: 'KZT' };
const service = {
  ...input,
  id: '00000000-0000-4000-8000-000000000001',
  description: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};
describe('strict branch service catalogue contracts', () => {
  it('normalizes compatible NFKC text and defaults nullable description', () => {
    expect(create.parse({ ...input, name: '  Ｅxterior   Wash  ' })).toEqual({
      ...input,
      name: 'Exterior Wash',
      description: null,
    });
    expect(create.parse({ ...input, description: '  Plain\ntext  ' }).description).toBe(
      'Plain\ntext',
    );
  });
  it.each([undefined, null, '', '   '])('nullable create description %s', (description) => {
    expect(
      create.parse({ ...input, ...(description === undefined ? {} : { description }) }).description,
    ).toBeNull();
  });
  it.each(['x', '', ' '.repeat(10), 'x'.repeat(121), 'Wash\tBay', 'Wash\u0000Bay'])(
    'rejects name %s before normalization can hide controls',
    (name) => expect(create.safeParse({ ...input, name }).success).toBe(false),
  );
  it.each(['x'.repeat(501), 'x\ty', 'x\u0000y'])(
    'rejects description bounds and controls',
    (description) => expect(create.safeParse({ ...input, description }).success).toBe(false),
  );
  it.each([2, 120])('accepts name boundary %s', (length) =>
    expect(
      create.safeParse({ ...input, name: 'x'.repeat(length), description: 'x'.repeat(500) })
        .success,
    ).toBe(true),
  );
  it.each([1, 1440])('duration boundary %s', (durationMinutes) =>
    expect(create.safeParse({ ...input, durationMinutes }).success).toBe(true),
  );
  it.each([0, 1441, -1, 1.1, '30', null, undefined])('invalid duration %s', (durationMinutes) =>
    expect(create.safeParse({ ...input, durationMinutes }).success).toBe(false),
  );
  it.each([1, 100000000])('price boundary %s', (priceMinor) =>
    expect(create.safeParse({ ...input, priceMinor }).success).toBe(true),
  );
  it.each([0, -1, 100000001, Number.MAX_SAFE_INTEGER + 1, 1.1, '500000', null, undefined])(
    'invalid price %s',
    (priceMinor) => expect(create.safeParse({ ...input, priceMinor }).success).toBe(false),
  );
  it.each(['USD', 'kzt', null, undefined])('invalid currency %s', (currency) =>
    expect(create.safeParse({ ...input, currency }).success).toBe(false),
  );
  it.each([
    'id',
    'branchId',
    'organizationId',
    'userId',
    'ownerUserId',
    'role',
    'password',
    'token',
    'createdAt',
    'updatedAt',
    'isActive',
  ])('rejects create %s', (key) =>
    expect(create.safeParse({ ...input, [key]: true }).success).toBe(false),
  );
  it('partial patch retains omissions and permits description clear', () => {
    expect(update.parse({ name: '  Exterior   wash ' })).toEqual({ name: 'Exterior wash' });
    expect(update.parse({ description: '  ' })).toEqual({ description: null });
    expect(
      update.parse({ description: null, durationMinutes: 1440, priceMinor: 1, isActive: false }),
    ).toEqual({ description: null, durationMinutes: 1440, priceMinor: 1, isActive: false });
  });
  it.each([
    {},
    { name: null },
    { priceMinor: null },
    { durationMinutes: null },
    { isActive: null },
    { isActive: 'false' },
    { currency: 'KZT' },
    { isActive: false, id: service.id },
  ])('rejects invalid/empty patch', (patch) => expect(update.safeParse(patch).success).toBe(false));
  it.each([
    'branchId',
    'organizationId',
    'userId',
    'ownerUserId',
    'createdAt',
    'updatedAt',
    'passwordHash',
    'permissions',
    'token',
  ])('rejects patch %s', (key) =>
    expect(update.safeParse({ name: 'Wash', [key]: true }).success).toBe(false),
  );
  it('parses strict public single/list and scoped UUID params', () => {
    expect(branchServiceResponseSchema.parse({ service }).service).toEqual(service);
    expect(branchServiceListResponseSchema.parse({ services: [service] }).services).toEqual([
      service,
    ]);
    expect(
      branchServiceIdParamsSchema.safeParse({
        organizationId: service.id,
        branchId: service.id,
        serviceId: service.id,
      }).success,
    ).toBe(true);
    expect(
      branchServiceIdParamsSchema.safeParse({
        organizationId: service.id,
        branchId: 'invalid',
        serviceId: service.id,
      }).success,
    ).toBe(false);
  });
  it.each([
    'branchId',
    'organizationId',
    'userId',
    'membershipId',
    'passwordHash',
    'token',
    'extra',
  ])('rejects public internal %s', (key) => {
    expect(publicService.safeParse({ ...service, [key]: 'internal' }).success).toBe(false);
    expect(
      branchServiceListResponseSchema.safeParse({ services: [{ ...service, [key]: true }] })
        .success,
    ).toBe(false);
    expect(branchServiceResponseSchema.safeParse({ service, [key]: true }).success).toBe(false);
  });
  it.each([
    { name: ' Wash ' },
    { description: '' },
    { createdAt: 'bad' },
    { id: 'bad' },
    { isActive: 'true' },
  ])('does not repair invalid public responses', (patch) =>
    expect(publicService.safeParse({ ...service, ...patch }).success).toBe(false),
  );
});
