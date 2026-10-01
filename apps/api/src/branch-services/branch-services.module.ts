import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { BranchesModule } from '../branches/branches.module.js';
import { BRANCH_OWNER_ACCESS, type BranchOwnerAccess } from '../branches/public.js';
import {
  BRANCH_SERVICE_REPOSITORY,
  type BranchServiceRepository,
} from './application/branch-service.repository.js';
import { CreateBranchServiceUseCase } from './application/create-branch-service.use-case.js';
import { ListBranchServicesUseCase } from './application/list-branch-services.use-case.js';
import { GetBranchServiceUseCase } from './application/get-branch-service.use-case.js';
import { UpdateBranchServiceUseCase } from './application/update-branch-service.use-case.js';
import { PrismaBranchServiceRepository } from './infrastructure/prisma-branch-service.repository.js';
import { BranchServicesController } from './presentation/branch-services.controller.js';
@Module({
  imports: [AuthModule, DatabaseModule, BranchesModule],
  controllers: [BranchServicesController],
  providers: [
    PrismaBranchServiceRepository,
    { provide: BRANCH_SERVICE_REPOSITORY, useExisting: PrismaBranchServiceRepository },
    ...[
      CreateBranchServiceUseCase,
      ListBranchServicesUseCase,
      GetBranchServiceUseCase,
      UpdateBranchServiceUseCase,
    ].map((useCase) => ({
      provide: useCase,
      inject: [BRANCH_OWNER_ACCESS, BRANCH_SERVICE_REPOSITORY],
      useFactory: (access: BranchOwnerAccess, repository: BranchServiceRepository) =>
        new useCase(access, repository),
    })),
  ],
})
export class BranchServicesModule {}
