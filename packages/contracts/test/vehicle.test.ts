import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createVehicleRequestSchema,
  createVehicleResponseSchema,
  publicVehicleSchema,
  vehicleListResponseSchema,
} from '../src/index.js';

const input = { make: 'Toyota', model: 'Camry', plateNumber: '123 ABC 01' };
const vehicle = {
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  ...input,
  plateNumber: '123ABC01',
  productionYear: null,
  color: null,
  createdAt: '2026-09-07T10:00:00.000Z',
  updatedAt: '2026-09-07T10:00:00.000Z',
};

afterEach(() => vi.useRealTimers());

describe('vehicle contracts', () => {
  it('normalizes requests and consistently defaults optional values to null', () => {
    expect(createVehicleRequestSchema.parse(input)).toEqual({
      ...input,
      plateNumber: '123ABC01',
      productionYear: null,
      color: null,
    });
    expect(
      createVehicleRequestSchema.parse({
        ...input,
        make: '  Land \t Rover ',
        model: ' Range  Rover ',
        color: ' Deep  Blue ',
      }),
    ).toMatchObject({ make: 'Land Rover', model: 'Range Rover', color: 'Deep Blue' });
  });
  it.each(['123 ABC 01', '123-ABC-01', '123abc01', ' １２３－ａｂｃ－０１ '])(
    'canonicalizes equivalent plate format %s',
    (plateNumber) => {
      expect(createVehicleRequestSchema.parse({ ...input, plateNumber }).plateNumber).toBe(
        '123ABC01',
      );
    },
  );
  it.each(['ӘІ١٢', '車123', '𐐀١', 'A'.repeat(20)])(
    'accepts Unicode letters/digits and canonical length',
    (plateNumber) => {
      expect(createVehicleRequestSchema.safeParse({ ...input, plateNumber }).success).toBe(true);
    },
  );
  it.each(['A', 'A'.repeat(21), 'AA/1', 'AA_1', '🚘123', 'AA.1', 'AA\u000012'])(
    'rejects invalid plates',
    (plateNumber) => {
      expect(createVehicleRequestSchema.safeParse({ ...input, plateNumber }).success).toBe(false);
    },
  );
  it.each([
    { make: ' A ' },
    { make: 'A'.repeat(61) },
    { model: ' ' },
    { model: 'A'.repeat(61) },
    { color: 'A'.repeat(41) },
    { productionYear: 1899 },
    { productionYear: 2024.5 },
    { productionYear: '2024' },
    { productionYear: true },
  ])('rejects invalid field limits or types', (fields) => {
    expect(createVehicleRequestSchema.safeParse({ ...input, ...fields }).success).toBe(false);
  });
  it('allows inclusive field bounds, nulls and empty color', () => {
    expect(
      createVehicleRequestSchema.parse({ ...input, make: 'AB', model: 'X', color: ' \t ' }).color,
    ).toBeNull();
    expect(
      createVehicleRequestSchema.safeParse({
        ...input,
        make: 'A'.repeat(60),
        model: 'A'.repeat(60),
        color: 'A'.repeat(40),
        productionYear: 1900,
      }).success,
    ).toBe(true);
  });
  it('evaluates the UTC year at parse time across a year boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2030-12-31T23:59:59Z');
    expect(createVehicleRequestSchema.safeParse({ ...input, productionYear: 2031 }).success).toBe(
      true,
    );
    expect(createVehicleRequestSchema.safeParse({ ...input, productionYear: 2032 }).success).toBe(
      false,
    );
    vi.setSystemTime('2031-01-01T00:00:00Z');
    expect(createVehicleRequestSchema.safeParse({ ...input, productionYear: 2032 }).success).toBe(
      true,
    );
  });
  it.each([
    'ownerUserId',
    'userId',
    'id',
    'createdAt',
    'password',
    'passwordHash',
    'accessToken',
    'refreshToken',
    'session',
    'unknown',
  ])('rejects the unknown request field %s', (field) => {
    expect(
      createVehicleRequestSchema.safeParse({ ...input, [field]: 'not-accepted' }).success,
    ).toBe(false);
  });
  it('parses strict public and list responses', () => {
    expect(publicVehicleSchema.parse(vehicle)).toEqual(vehicle);
    expect(createVehicleResponseSchema.parse({ vehicle })).toEqual({ vehicle });
    expect(vehicleListResponseSchema.parse({ vehicles: [vehicle] })).toEqual({
      vehicles: [vehicle],
    });
    expect(vehicleListResponseSchema.parse({ vehicles: [] })).toEqual({ vehicles: [] });
  });
  it.each([
    { id: 'bad-id' },
    { createdAt: 'yesterday' },
    { updatedAt: '2026-09-07' },
    { plateNumber: '123 abc 01' },
    { make: ' Toyota ' },
    { color: '' },
    { productionYear: undefined },
    { ownerUserId: 'not-public' },
    { userId: 'not-public' },
    { passwordHash: 'not-public' },
    { accessToken: 'not-public' },
  ])('rejects invalid or private public response data', (fields) => {
    expect(
      createVehicleResponseSchema.safeParse({ vehicle: { ...vehicle, ...fields } }).success,
    ).toBe(false);
    expect(
      vehicleListResponseSchema.safeParse({ vehicles: [{ ...vehicle, ...fields }] }).success,
    ).toBe(false);
  });
  it('rejects root internals and missing list/vehicle', () => {
    expect(
      createVehicleResponseSchema.safeParse({ vehicle, ownerUserId: 'not-public' }).success,
    ).toBe(false);
    expect(
      vehicleListResponseSchema.safeParse({ vehicles: [], accessToken: 'not-public' }).success,
    ).toBe(false);
    expect(vehicleListResponseSchema.safeParse({}).success).toBe(false);
    expect(createVehicleResponseSchema.safeParse({}).success).toBe(false);
  });
});
