import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { healthResponseSchema, readinessResponseSchema } from '@washqueue/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATABASE_READINESS, type DatabaseReadiness } from '../src/database/database-readiness.js';
import { HealthController } from '../src/health/health.controller.js';
import { HealthService } from '../src/health/health.service.js';
import { HttpExceptionFilter } from '../src/http/http-exception.filter.js';
import { requestIdMiddleware } from '../src/http/request-id.middleware.js';

describe('health endpoints', () => {
  let app: INestApplication;
  let databaseReady = true;

  beforeEach(async () => {
    const readiness: DatabaseReadiness = {
      isReady: async () => databaseReady,
    };
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: DATABASE_READINESS,
          useValue: readiness,
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(requestIdMiddleware);
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    databaseReady = true;
  });

  it('returns a contract-valid liveness response', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(healthResponseSchema.parse(response.body)).toEqual(response.body);
  });

  it('returns database readiness without sensitive details', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);

    expect(readinessResponseSchema.parse(response.body)).toEqual(response.body);
    expect(JSON.stringify(response.body)).not.toContain('postgresql://');
  });

  it('returns a sanitized 503 response when the database is unavailable', async () => {
    databaseReady = false;

    const response = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);

    expect(response.body).toMatchObject({
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database connection is unavailable',
      },
      path: '/api/v1/health/ready',
    });
    expect(response.body).toHaveProperty('requestId');
  });
});
