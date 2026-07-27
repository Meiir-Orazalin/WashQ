import { ConfigService } from '@nestjs/config';
import { readinessResponseSchema } from '@washqueue/contracts';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { HealthService } from '../src/health/health.service.js';
import { getSafeTestDatabaseUrl } from './safe-test-database-url.js';

describe('PostgreSQL readiness integration', () => {
  it('reports readiness through the production database adapter', async () => {
    const databaseUrl = getSafeTestDatabaseUrl(process.env);
    const config = new ConfigService({ database: { url: databaseUrl } });
    const prisma = new PrismaService(config);
    const health = new HealthService(prisma);

    try {
      await prisma.onModuleInit();
      const response = await health.readiness();

      expect(response).not.toBeNull();
      expect(readinessResponseSchema.parse(response)).toEqual(response);
    } finally {
      await prisma.onModuleDestroy();
    }
  });
});
