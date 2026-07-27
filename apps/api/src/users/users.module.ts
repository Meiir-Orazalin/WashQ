import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { USER_REPOSITORY } from './application/user-repository.js';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    PrismaUserRepository,
    {
      provide: USER_REPOSITORY,
      useExisting: PrismaUserRepository,
    },
  ],
  exports: [USER_REPOSITORY],
})
export class UsersModule {}
