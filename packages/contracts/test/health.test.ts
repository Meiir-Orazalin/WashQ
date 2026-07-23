import { describe, expect, it } from 'vitest';
import { healthResponseSchema, readinessResponseSchema } from '../src/index.js';

const timestamp = '2026-07-23T12:00:00.000Z';

describe('health contracts', () => {
  it('parses a valid health response', () => {
    expect(
      healthResponseSchema.parse({
        status: 'ok',
        service: 'washqueue-api',
        timestamp,
      }),
    ).toEqual({
      status: 'ok',
      service: 'washqueue-api',
      timestamp,
    });
  });

  it('rejects an unexpected service name', () => {
    expect(() =>
      healthResponseSchema.parse({
        status: 'ok',
        service: 'another-service',
        timestamp,
      }),
    ).toThrow();
  });

  it('parses database readiness without infrastructure details', () => {
    expect(
      readinessResponseSchema.parse({
        status: 'ok',
        service: 'washqueue-api',
        timestamp,
        checks: { database: 'up' },
      }),
    ).toMatchObject({ checks: { database: 'up' } });
  });
});
