import { Module } from '@nestjs/common';
import { ORGANIZATION_OWNER_ACCESS } from './public.js';
import { CurrentOrganizationOwnerAccess } from './application/organization-owner-access.js';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { CreateOrganizationUseCase } from './application/create-organization.use-case.js';
import { ListOwnedOrganizationsUseCase } from './application/list-owned-organizations.use-case.js';
import { GetOwnedOrganizationUseCase } from './application/get-owned-organization.use-case.js';
import {
  ORGANIZATION_REPOSITORY,
  type OrganizationRepository,
} from './application/organization.repository.js';
import { PrismaOrganizationRepository } from './infrastructure/prisma-organization.repository.js';
import { OrganizationsController } from './presentation/organizations.controller.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [OrganizationsController],
  providers: [
    {
      provide: ORGANIZATION_OWNER_ACCESS,
      inject: [ORGANIZATION_REPOSITORY],
      useFactory: (repository: OrganizationRepository) =>
        new CurrentOrganizationOwnerAccess(repository),
    },
    PrismaOrganizationRepository,
    { provide: ORGANIZATION_REPOSITORY, useExisting: PrismaOrganizationRepository },
    {
      provide: CreateOrganizationUseCase,
      inject: [ORGANIZATION_REPOSITORY],
      useFactory: (repository: OrganizationRepository) => new CreateOrganizationUseCase(repository),
    },
    {
      provide: ListOwnedOrganizationsUseCase,
      inject: [ORGANIZATION_REPOSITORY],
      useFactory: (repository: OrganizationRepository) =>
        new ListOwnedOrganizationsUseCase(repository),
    },
    {
      provide: GetOwnedOrganizationUseCase,
      inject: [ORGANIZATION_REPOSITORY],
      useFactory: (repository: OrganizationRepository) =>
        new GetOwnedOrganizationUseCase(repository),
    },
  ],
  exports: [ORGANIZATION_OWNER_ACCESS],
})
export class OrganizationsModule {}
