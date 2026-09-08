import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { UsersModule } from './users.module.js';
import { UsersController } from './presentation/users.controller.js';

/** HTTP composition only: users persistence does not depend on authentication. */
@Module({ imports: [AuthModule, UsersModule], controllers: [UsersController] })
export class UsersHttpModule {}
