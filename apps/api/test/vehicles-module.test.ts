import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../src/database/prisma.service.js';
import { HealthModule } from '../src/health/health.module.js';
import { HttpExceptionFilter } from '../src/http/http-exception.filter.js';
import { ZodValidationPipe } from '../src/http/zod-validation.pipe.js';
import { VehiclesModule } from '../src/vehicles/vehicles.module.js';

@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useValue: new ConfigService({
        authentication: {
          accessTokenSigningSecret: 's'.repeat(48),
          accessTokenLifetimeSeconds: 900,
          refreshTokenLifetimeSeconds: 3600,
        },
        application: { nodeEnv: 'test', corsOrigins: ['http://localhost:3000'] },
      }),
    },
  ],
  exports: [ConfigService],
})
class TestConfigurationModule {}

describe('production vehicle module composition', () => {
  it('resolves the exported auth use case and protects only the vehicle controller', async () => {
    const module = await Test.createTestingModule({
      imports: [TestConfigurationModule, VehiclesModule, HealthModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ isReady: async () => true })
      .compile();
    const app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    try {
      await request(app.getHttpServer()).get('/api/v1/health').expect(200);
      await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
      await request(app.getHttpServer()).post('/api/v1/auth/register').send({}).expect(400);
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({}).expect(400);
      await request(app.getHttpServer()).post('/api/v1/auth/logout').expect(204);
      const refresh = await request(app.getHttpServer()).post('/api/v1/auth/refresh').expect(401);
      expect(refresh.body.error.code).toBe('INVALID_REFRESH_SESSION');
      const vehicle = await request(app.getHttpServer()).get('/api/v1/vehicles').expect(401);
      expect(vehicle.body.error.code).toBe('AUTHENTICATION_REQUIRED');
      await request(app.getHttpServer()).post('/api/v1/vehicles').send({}).expect(401);
    } finally {
      await app.close();
    }
  });
});
