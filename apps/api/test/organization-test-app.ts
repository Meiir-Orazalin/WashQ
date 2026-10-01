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
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from '../src/organizations/application/organization.repository.js';
import { OrganizationsModule } from '../src/organizations/organizations.module.js';
import { BranchesModule } from '../src/branches/branches.module.js';
import { WashBoxesModule } from '../src/wash-boxes/wash-boxes.module.js';
import {
  WASH_BOX_REPOSITORY,
  type WashBoxRepository,
} from '../src/wash-boxes/application/wash-box.repository.js';
import {
  BRANCH_REPOSITORY,
  type BranchRepository,
} from '../src/branches/application/branch.repository.js';

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
class OrganizationTestConfigurationModule {}

export async function createOrganizationTestApp(
  users: UserRepository,
  tokens: AccessTokenService,
  organizations: OrganizationRepository,
  branches?: BranchRepository,
  washBoxes?: WashBoxRepository,
) {
  const module = await Test.createTestingModule({
    imports: [
      OrganizationTestConfigurationModule,
      OrganizationsModule,
      HealthModule,
      ...(branches ? [BranchesModule] : []),
      ...(washBoxes ? [WashBoxesModule] : []),
    ],
  })
    .overrideProvider(PrismaService)
    .useValue({ isReady: async () => true })
    .overrideProvider(USER_REPOSITORY)
    .useValue(users)
    .overrideProvider(ACCESS_TOKEN_SERVICE)
    .useValue(tokens)
    .overrideProvider(ORGANIZATION_REPOSITORY)
    .useValue(organizations)
    .overrideProvider(BRANCH_REPOSITORY)
    .useValue(branches)
    .overrideProvider(WASH_BOX_REPOSITORY)
    .useValue(washBoxes)
    .compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(requestIdMiddleware);
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}
