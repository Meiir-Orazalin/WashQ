import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { RegisterCustomerUseCase } from './application/register-customer.use-case.js';
import { PASSWORD_HASHER, type PasswordHasher } from './application/password-hasher.js';
import { Argon2PasswordHasher } from './infrastructure/argon2-password.hasher.js';
import { AuthController } from './presentation/auth.controller.js';
import { USER_REPOSITORY, type UserRepository } from '../users/application/user-repository.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [
    Argon2PasswordHasher,
    {
      provide: PASSWORD_HASHER,
      useExisting: Argon2PasswordHasher,
    },
    {
      provide: RegisterCustomerUseCase,
      inject: [PASSWORD_HASHER, USER_REPOSITORY],
      useFactory: (passwordHasher: PasswordHasher, userRepository: UserRepository) =>
        new RegisterCustomerUseCase(passwordHasher, userRepository),
    },
  ],
})
export class AuthModule {}
