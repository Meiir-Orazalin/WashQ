import { describe, expect, it } from 'vitest';
import {
  createWashBoxRequestSchema,
  setWashBoxActiveStateRequestSchema,
  washBoxSchema,
  washBoxResponseSchema,
  washBoxListResponseSchema,
  washBoxIdParamsSchema,
} from '../src/wash-box.js';
const id = '00000000-0000-4000-8000-000000000001';
const box = {
  id,
  number: 1,
  isActive: true,
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
};
describe('strict wash box transport contracts', () => {
  it.each([1, 999])('accepts integer boundary %s', (number) =>
    expect(createWashBoxRequestSchema.parse({ number })).toEqual({ number }),
  );
  it.each([0, 1000, -1, 1.5, '1', null, undefined, NaN, Infinity])(
    'rejects invalid number %s',
    (number) => expect(createWashBoxRequestSchema.safeParse({ number }).success).toBe(false),
  );
  it.each([true, false])('accepts explicit boolean %s', (isActive) =>
    expect(setWashBoxActiveStateRequestSchema.parse({ isActive })).toEqual({ isActive }),
  );
  it.each([
    {},
    null,
    { isActive: null },
    { isActive: 'false' },
    { isActive: 0 },
    { isActive: undefined },
  ])('rejects malformed state input', (input) =>
    expect(setWashBoxActiveStateRequestSchema.safeParse(input).success).toBe(false),
  );
  const forbidden = [
    'id',
    'organizationId',
    'branchId',
    'userId',
    'ownerUserId',
    'role',
    'membershipRole',
    'password',
    'passwordHash',
    'token',
    'createdAt',
    'updatedAt',
  ];
  it.each(forbidden)('rejects spoof/immutable field %s in both writes', (field) => {
    expect(createWashBoxRequestSchema.safeParse({ number: 1, [field]: id }).success).toBe(false);
    expect(
      setWashBoxActiveStateRequestSchema.safeParse({ isActive: false, [field]: id }).success,
    ).toBe(false);
  });
  it('rejects active creation input and renumbering', () => {
    expect(createWashBoxRequestSchema.safeParse({ number: 1, isActive: false }).success).toBe(
      false,
    );
    expect(
      setWashBoxActiveStateRequestSchema.safeParse({ isActive: true, number: 2 }).success,
    ).toBe(false);
  });
  it('parses strict single/list responses and inactive boxes', () => {
    expect(
      washBoxResponseSchema.parse({ washBox: { ...box, isActive: false } }).washBox.isActive,
    ).toBe(false);
    expect(washBoxListResponseSchema.parse({ washBoxes: [] })).toEqual({ washBoxes: [] });
    expect(washBoxListResponseSchema.parse({ washBoxes: [box] }).washBoxes).toHaveLength(1);
  });
  it.each([
    'organizationId',
    'branchId',
    'userId',
    'ownerUserId',
    'membershipId',
    'passwordHash',
    'token',
    'numberMinute',
  ])('rejects public internal field %s', (field) => {
    const invalid = { ...box, [field]: id };
    expect(washBoxSchema.safeParse(invalid).success).toBe(false);
    expect(washBoxResponseSchema.safeParse({ washBox: invalid }).success).toBe(false);
    expect(washBoxListResponseSchema.safeParse({ washBoxes: [invalid] }).success).toBe(false);
  });
  it('rejects invalid identifiers, timestamps, public scalars and envelopes', () => {
    for (const patch of [
      { id: 'invalid' },
      { createdAt: 'yesterday' },
      { updatedAt: 'today' },
      { number: '1' },
      { isActive: 'true' },
    ])
      expect(washBoxSchema.safeParse({ ...box, ...patch }).success).toBe(false);
    expect(washBoxResponseSchema.safeParse({ washBox: box, token: 'internal' }).success).toBe(
      false,
    );
    expect(washBoxListResponseSchema.safeParse({ washBoxes: [box], userId: id }).success).toBe(
      false,
    );
    expect(
      washBoxIdParamsSchema.safeParse({ organizationId: id, branchId: id, washBoxId: id }).success,
    ).toBe(true);
    for (const key of ['organizationId', 'branchId', 'washBoxId'])
      expect(
        washBoxIdParamsSchema.safeParse({
          organizationId: id,
          branchId: id,
          washBoxId: id,
          [key]: 'invalid',
        }).success,
      ).toBe(false);
  });
});
