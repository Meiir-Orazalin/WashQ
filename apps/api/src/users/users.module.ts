import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { USER_REPOSITORY, type UserRepository } from './application/user-repository.js';
import { UpdateCurrentUserProfileUseCase } from './application/update-current-user-profile.use-case.js';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: UpdateCurrentUserProfileUseCase,
      inject: [USER_REPOSITORY],
      useFactory: (repository: UserRepository) => new UpdateCurrentUserProfileUseCase(repository),
    },
    PrismaUserRepository,
    {
      provide: USER_REPOSITORY,
      useExisting: PrismaUserRepository,
    },
  ],
  exports: [USER_REPOSITORY, UpdateCurrentUserProfileUseCase],
})
export class UsersModule {}
