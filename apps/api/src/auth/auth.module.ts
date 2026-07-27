import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module.js';
import { UsersModule } from '../users/users.module.js';
import {
  ACCESS_TOKEN_SERVICE,
  type AccessTokenService,
} from './application/access-token.service.js';
import { RegisterCustomerUseCase } from './application/register-customer.use-case.js';
import { PASSWORD_HASHER, type PasswordHasher } from './application/password-hasher.js';
import { REFRESH_SESSION_REPOSITORY } from './application/refresh-session.repository.js';
import { REFRESH_TOKEN_GENERATOR } from './application/refresh-token-generator.js';
import { REFRESH_TOKEN_HASHER } from './application/refresh-token-hasher.js';
import { Argon2PasswordHasher } from './infrastructure/argon2-password.hasher.js';
import { CryptoRefreshTokenGenerator } from './infrastructure/crypto-refresh-token.generator.js';
import { JoseAccessTokenService } from './infrastructure/jose-access-token.service.js';
import { PrismaRefreshSessionRepository } from './infrastructure/prisma-refresh-session.repository.js';
import { Sha256RefreshTokenHasher } from './infrastructure/sha256-refresh-token.hasher.js';
import { AuthController } from './presentation/auth.controller.js';
import { USER_REPOSITORY, type UserRepository } from '../users/application/user-repository.js';

@Module({
  imports: [DatabaseModule, UsersModule],
  controllers: [AuthController],
  providers: [
    Argon2PasswordHasher,
    CryptoRefreshTokenGenerator,
    PrismaRefreshSessionRepository,
    Sha256RefreshTokenHasher,
    {
      provide: PASSWORD_HASHER,
      useExisting: Argon2PasswordHasher,
    },
    {
      provide: REFRESH_TOKEN_GENERATOR,
      useExisting: CryptoRefreshTokenGenerator,
    },
    {
      provide: REFRESH_TOKEN_HASHER,
      useExisting: Sha256RefreshTokenHasher,
    },
    {
      provide: REFRESH_SESSION_REPOSITORY,
      useExisting: PrismaRefreshSessionRepository,
    },
    {
      provide: ACCESS_TOKEN_SERVICE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AccessTokenService =>
        new JoseAccessTokenService({
          signingSecret: config.getOrThrow<string>('authentication.accessTokenSigningSecret'),
          lifetimeSeconds: config.getOrThrow<number>('authentication.accessTokenLifetimeSeconds'),
        }),
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
