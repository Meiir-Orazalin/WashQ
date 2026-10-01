import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import {
  ORGANIZATION_OWNER_ACCESS,
  type OrganizationOwnerAccess,
} from '../organizations/public.js';
import { BRANCH_REPOSITORY, type BranchRepository } from './application/branch.repository.js';
import { CreateBranchUseCase } from './application/create-branch.use-case.js';
import { ListOwnedOrganizationBranchesUseCase } from './application/list-owned-organization-branches.use-case.js';
import { GetOwnedBranchUseCase } from './application/get-owned-branch.use-case.js';
import { ReplaceBranchOpeningHoursUseCase } from './application/replace-branch-opening-hours.use-case.js';
import { PrismaBranchRepository } from './infrastructure/prisma-branch.repository.js';
import { BranchesController } from './presentation/branches.controller.js';
import { BRANCH_OWNER_ACCESS } from './public.js';
import { CurrentBranchOwnerAccess } from './application/current-branch-owner-access.js';
@Module({
  imports: [AuthModule, DatabaseModule, OrganizationsModule],
  controllers: [BranchesController],
  providers: [
    {
      provide: BRANCH_OWNER_ACCESS,
      inject: [GetOwnedBranchUseCase],
      useFactory: (getOwnedBranch: GetOwnedBranchUseCase) =>
        new CurrentBranchOwnerAccess(getOwnedBranch),
    },
    PrismaBranchRepository,
    { provide: BRANCH_REPOSITORY, useExisting: PrismaBranchRepository },
    ...[
      CreateBranchUseCase,
      ListOwnedOrganizationBranchesUseCase,
      GetOwnedBranchUseCase,
      ReplaceBranchOpeningHoursUseCase,
    ].map((useCase) => ({
      provide: useCase,
      inject: [ORGANIZATION_OWNER_ACCESS, BRANCH_REPOSITORY],
      useFactory: (access: OrganizationOwnerAccess, repository: BranchRepository) =>
        new useCase(access, repository),
    })),
  ],
  exports: [BRANCH_OWNER_ACCESS],
})
export class BranchesModule {}
