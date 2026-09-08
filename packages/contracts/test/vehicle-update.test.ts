import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  updateVehicleRequestSchema,
  updateVehicleResponseSchema,
  vehicleIdParamsSchema,
} from '../src/index.js';

afterEach(() => vi.useRealTimers());

describe('partial vehicle update contracts', () => {
  it('accepts one field without defaulting omitted optionals', () => {
    expect(updateVehicleRequestSchema.parse({ model: '  Camry   Hybrid ' })).toEqual({
      model: 'Camry Hybrid',
    });
  });
  it('normalizes all mutable fields and preserves explicit clears', () => {
    expect(
      updateVehicleRequestSchema.parse({
        make: ' Land  Rover ',
        model: ' Range  Rover ',
        plateNumber: '１２３－ａｂｃ－０１',
        productionYear: null,
        color: ' Pearl  White ',
      }),
    ).toEqual({
      make: 'Land Rover',
      model: 'Range Rover',
      plateNumber: '123ABC01',
      productionYear: null,
      color: 'Pearl White',
    });
  });
  it.each(['123 ABC 01', '123-ABC-01', '123abc01'])(
    'reuses canonicalization for %s',
    (plateNumber) => {
      expect(updateVehicleRequestSchema.parse({ plateNumber })).toEqual({
        plateNumber: '123ABC01',
      });
    },
  );
  it.each(['ӘІ١٢', '車123', '𐐀١'])('accepts Unicode letters and decimal digits', (plateNumber) => {
    expect(updateVehicleRequestSchema.safeParse({ plateNumber }).success).toBe(true);
  });
  it.each([
    {},
    { color: undefined },
    { make: null },
    { model: null },
    { plateNumber: null },
    { make: 12 },
    { make: 'A' },
    { make: 'A'.repeat(61) },
    { model: '' },
    { model: 'A'.repeat(61) },
    { plateNumber: 'A' },
    { plateNumber: 'A'.repeat(21) },
    { plateNumber: 'AB/01' },
    { plateNumber: 'AB_01' },
    { plateNumber: '🚘01' },
    { productionYear: '2024' },
    { productionYear: 2024.5 },
    { productionYear: 1899 },
    { color: 'A'.repeat(41) },
  ])('rejects invalid, empty or null-required fields', (patch) => {
    expect(updateVehicleRequestSchema.safeParse(patch).success).toBe(false);
  });
  it.each([
    'unknown',
    'ownerUserId',
    'userId',
    'id',
    'createdAt',
    'updatedAt',
    'password',
    'passwordHash',
    'token',
    'accessToken',
    'refreshToken',
  ])('rejects %s even with a valid update', (field) => {
    expect(
      updateVehicleRequestSchema.safeParse({ model: 'Hybrid', [field]: 'not-public' }).success,
    ).toBe(false);
  });
  it.each([null, '', ' \t '])('clears empty or null color', (color) => {
    expect(updateVehicleRequestSchema.parse({ color })).toEqual({ color: null });
  });
  it('checks the current UTC year at parse time and allows inclusive limits', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2030-12-31T23:59:59Z');
    for (const productionYear of [1900, 2031])
      expect(updateVehicleRequestSchema.safeParse({ productionYear }).success).toBe(true);
    expect(updateVehicleRequestSchema.safeParse({ productionYear: 2032 }).success).toBe(false);
    vi.setSystemTime('2031-01-01T00:00:00Z');
    expect(updateVehicleRequestSchema.safeParse({ productionYear: 2032 }).success).toBe(true);
  });
  it('requires a strict UUID path parameter', () => {
    const vehicleId = 'df4e7850-e329-4679-91f1-77b409d93f4f';
    expect(vehicleIdParamsSchema.parse({ vehicleId })).toEqual({ vehicleId });
    for (const params of [{}, { vehicleId: 'invalid' }, { vehicleId, userId: vehicleId }])
      expect(vehicleIdParamsSchema.safeParse(params).success).toBe(false);
  });
  it('reuses the strict public projection for update responses', () => {
    const vehicle = {
      id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
      make: 'Toyota',
      model: 'Camry',
      plateNumber: '123ABC01',
      productionYear: null,
      color: null,
      createdAt: '2026-09-07T10:00:00Z',
      updatedAt: '2026-09-08T10:00:00Z',
    };
    expect(updateVehicleResponseSchema.parse({ vehicle })).toEqual({ vehicle });
    for (const field of ['ownerUserId', 'userId', 'passwordHash', 'accessToken'])
      expect(
        updateVehicleResponseSchema.safeParse({ vehicle: { ...vehicle, [field]: 'private' } })
          .success,
      ).toBe(false);
    expect(updateVehicleResponseSchema.safeParse({ vehicle, internal: true }).success).toBe(false);
    expect(
      updateVehicleResponseSchema.safeParse({ vehicle: { ...vehicle, plateNumber: '123 abc 01' } })
        .success,
    ).toBe(false);
  });
});
