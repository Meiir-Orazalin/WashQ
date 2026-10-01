import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { BranchesModule } from '../branches/branches.module.js';
import { BRANCH_OWNER_ACCESS, type BranchOwnerAccess } from '../branches/public.js';
import { WASH_BOX_REPOSITORY, type WashBoxRepository } from './application/wash-box.repository.js';
import { CreateWashBoxUseCase } from './application/create-wash-box.use-case.js';
import { ListBranchWashBoxesUseCase } from './application/list-branch-wash-boxes.use-case.js';
import { GetBranchWashBoxUseCase } from './application/get-branch-wash-box.use-case.js';
import { SetWashBoxActiveStateUseCase } from './application/set-wash-box-active-state.use-case.js';
import { PrismaWashBoxRepository } from './infrastructure/prisma-wash-box.repository.js';
import { WashBoxesController } from './presentation/wash-boxes.controller.js';
@Module({
  imports: [AuthModule, DatabaseModule, BranchesModule],
  controllers: [WashBoxesController],
  providers: [
    PrismaWashBoxRepository,
    { provide: WASH_BOX_REPOSITORY, useExisting: PrismaWashBoxRepository },
    ...[
      CreateWashBoxUseCase,
      ListBranchWashBoxesUseCase,
      GetBranchWashBoxUseCase,
      SetWashBoxActiveStateUseCase,
    ].map((useCase) => ({
      provide: useCase,
      inject: [BRANCH_OWNER_ACCESS, WASH_BOX_REPOSITORY],
      useFactory: (access: BranchOwnerAccess, repository: WashBoxRepository) =>
        new useCase(access, repository),
    })),
  ],
})
export class WashBoxesModule {}
