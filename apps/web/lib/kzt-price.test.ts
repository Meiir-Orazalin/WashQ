import { describe, expect, it } from 'vitest';
import { formatKztPrice, kztPriceInput, parseKztPrice } from './kzt-price';
import { serviceEditFields, validateServiceForm } from './branch-service-form';
describe('exact bounded KZT string conversion', () => {
  it.each([
    ['5000', 500000],
    ['5000.50', 500050],
    ['5000,50', 500050],
    ['0.01', 1],
    ['1.2', 120],
    [' 001.20 ', 120],
    ['1000000', 100000000],
  ])('%s becomes %s minor units', (value, minor) => expect(parseKztPrice(value)).toBe(minor));
  it.each([
    '',
    '0',
    '-1',
    '+1',
    '1e3',
    '1.234',
    '1,2.3',
    '1,000,00',
    '.01',
    '1.',
    '1x',
    '1 000',
    '1000000.01',
    '99999999999999',
    '0.001',
  ])('rejects %s without rounding or partial parsing', (value) =>
    expect(parseKztPrice(value)).toBeNull(),
  );
  it.each([1, 101, 500050, 100000000])('round trips every minor unit for %s', (minor) =>
    expect(parseKztPrice(kztPriceInput(minor))).toBe(minor),
  );
  it('formats visible currency without modifying input precision', () =>
    expect(formatKztPrice(500050)).toMatch(/KZT.*5,000\.50/));
  it('edit only sends intended normalized changes, preserves currency and other omissions', () => {
    const service = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Wash',
      description: 'Plain',
      durationMinutes: 30,
      priceMinor: 500050,
      currency: 'KZT' as const,
      isActive: true,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    };
    const fields = serviceEditFields(service);
    expect(fields.price).toBe('5000.50');
    const result = validateServiceForm({ ...fields, description: ' ' }, service).result;
    expect(result.success && result.data).toEqual({ description: null });
    expect(validateServiceForm(fields, service).result.success).toBe(false);
    expect(validateServiceForm({ ...fields, durationMinutes: '30x' }).result.success).toBe(false);
  });
});
