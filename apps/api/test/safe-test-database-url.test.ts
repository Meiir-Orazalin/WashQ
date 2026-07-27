import { describe, expect, it } from 'vitest';
import { getSafeTestDatabaseUrl } from './safe-test-database-url.js';

const safeUrl = 'postgresql://washqueue:local-only@localhost:5432/washqueue_test';

describe('test database URL safety', () => {
  it('accepts a local database reserved for tests', () => {
    expect(
      getSafeTestDatabaseUrl({
        NODE_ENV: 'test',
        TEST_DATABASE_URL: safeUrl,
      }),
    ).toBe(safeUrl);
  });

  it.each([
    {
      name: 'a non-test process',
      environment: { NODE_ENV: 'production', TEST_DATABASE_URL: safeUrl },
    },
    {
      name: 'a remote database host',
      environment: {
        NODE_ENV: 'test',
        TEST_DATABASE_URL: 'postgresql://washqueue:local-only@db.example.com:5432/washqueue_test',
      },
    },
    {
      name: 'a database without a test suffix',
      environment: {
        NODE_ENV: 'test',
        TEST_DATABASE_URL: 'postgresql://washqueue:local-only@localhost:5432/washqueue',
      },
    },
  ])('rejects $name', ({ environment }) => {
    expect(() => getSafeTestDatabaseUrl(environment)).toThrow(/NODE_ENV=test|local test database/);
  });
});
