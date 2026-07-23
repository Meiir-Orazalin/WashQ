import { PrismaPg } from '@prisma/adapter-pg';
import { readinessResponseSchema, serviceName } from '@washqueue/contracts';
import { describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client.js';

describe('PostgreSQL readiness integration', () => {
  it('connects and executes the readiness query', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for integration tests');
    }

    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });

    try {
      await prisma.$connect();
      const result = await prisma.$queryRaw<{ readiness: number }[]>`
        SELECT 1 AS readiness
      `;

      expect(result).toEqual([{ readiness: 1 }]);
      expect(
        readinessResponseSchema.parse({
          status: 'ok',
          service: serviceName,
          timestamp: '2026-07-23T12:00:00.000Z',
          checks: { database: 'up' },
        }),
      ).toBeDefined();
    } finally {
      await prisma.$disconnect();
    }
  });
});
