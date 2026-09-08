import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  ACCESS_TOKEN_SERVICE,
  type AccessTokenService,
} from '../src/auth/application/access-token.service.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { HealthModule } from '../src/health/health.module.js';
import { HttpExceptionFilter } from '../src/http/http-exception.filter.js';
import { requestIdMiddleware } from '../src/http/request-id.middleware.js';
import { ZodValidationPipe } from '../src/http/zod-validation.pipe.js';
import { USER_REPOSITORY, type UserRepository } from '../src/users/application/user-repository.js';
import { UsersHttpModule } from '../src/users/users-http.module.js';

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
class ProfileTestConfigurationModule {}

export async function createProfileTestApp(users: UserRepository, tokens: AccessTokenService) {
  const module = await Test.createTestingModule({
    imports: [ProfileTestConfigurationModule, UsersHttpModule, HealthModule],
  })
    .overrideProvider(PrismaService)
    .useValue({ isReady: async () => true })
    .overrideProvider(USER_REPOSITORY)
    .useValue(users)
    .overrideProvider(ACCESS_TOKEN_SERVICE)
    .useValue(tokens)
    .compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(requestIdMiddleware);
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}
