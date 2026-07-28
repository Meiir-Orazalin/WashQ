import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module.js';
import { UsersModule } from '../users/users.module.js';
import {
  ACCESS_TOKEN_SERVICE,
  type AccessTokenService,
} from './application/access-token.service.js';
import { GetCurrentUserUseCase } from './application/get-current-user.use-case.js';
import { LoginCustomerUseCase } from './application/login-customer.use-case.js';
import { LogoutCurrentSessionUseCase } from './application/logout-current-session.use-case.js';
import { RegisterCustomerUseCase } from './application/register-customer.use-case.js';
import { RotateRefreshSessionUseCase } from './application/rotate-refresh-session.use-case.js';
import { PASSWORD_HASHER, type PasswordHasher } from './application/password-hasher.js';
import {
  REFRESH_SESSION_REPOSITORY,
  type RefreshSessionRepository,
} from './application/refresh-session.repository.js';
import {
  REFRESH_TOKEN_GENERATOR,
  type RefreshTokenGenerator,
} from './application/refresh-token-generator.js';
import {
  REFRESH_TOKEN_HASHER,
  type RefreshTokenHasher,
} from './application/refresh-token-hasher.js';
import { Argon2PasswordHasher } from './infrastructure/argon2-password.hasher.js';
import { CryptoRefreshTokenGenerator } from './infrastructure/crypto-refresh-token.generator.js';
import { JoseAccessTokenService } from './infrastructure/jose-access-token.service.js';
import { PrismaRefreshSessionRepository } from './infrastructure/prisma-refresh-session.repository.js';
import { Sha256RefreshTokenHasher } from './infrastructure/sha256-refresh-token.hasher.js';
import { AuthController } from './presentation/auth.controller.js';
import { RefreshRequestOriginPolicy } from './presentation/refresh-request-origin.policy.js';
import { RefreshTokenCookiePolicy } from './presentation/refresh-token-cookie.policy.js';
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
    {
      provide: GetCurrentUserUseCase,
      inject: [ACCESS_TOKEN_SERVICE, USER_REPOSITORY],
      useFactory: (accessTokenService: AccessTokenService, userRepository: UserRepository) =>
        new GetCurrentUserUseCase(accessTokenService, userRepository),
    },
    {
      provide: LoginCustomerUseCase,
      inject: [
        USER_REPOSITORY,
        PASSWORD_HASHER,
        ACCESS_TOKEN_SERVICE,
        REFRESH_TOKEN_GENERATOR,
        REFRESH_TOKEN_HASHER,
        REFRESH_SESSION_REPOSITORY,
        ConfigService,
      ],
      useFactory: (
        userRepository: UserRepository,
        passwordHasher: PasswordHasher,
        accessTokenService: AccessTokenService,
        refreshTokenGenerator: RefreshTokenGenerator,
        refreshTokenHasher: RefreshTokenHasher,
        refreshSessionRepository: RefreshSessionRepository,
        config: ConfigService,
      ) =>
        new LoginCustomerUseCase(
          userRepository,
          passwordHasher,
          accessTokenService,
          refreshTokenGenerator,
          refreshTokenHasher,
          refreshSessionRepository,
          {
            refreshTokenLifetimeSeconds: config.getOrThrow<number>(
              'authentication.refreshTokenLifetimeSeconds',
            ),
          },
        ),
    },
    {
      provide: RefreshTokenCookiePolicy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new RefreshTokenCookiePolicy({
          nodeEnv: config.getOrThrow<'development' | 'test' | 'production'>('application.nodeEnv'),
          refreshTokenLifetimeSeconds: config.getOrThrow<number>(
            'authentication.refreshTokenLifetimeSeconds',
          ),
        }),
    },
    {
      provide: RotateRefreshSessionUseCase,
      inject: [
        REFRESH_TOKEN_HASHER,
        REFRESH_TOKEN_GENERATOR,
        ACCESS_TOKEN_SERVICE,
        REFRESH_SESSION_REPOSITORY,
        ConfigService,
      ],
      useFactory: (
        refreshTokenHasher: RefreshTokenHasher,
        refreshTokenGenerator: RefreshTokenGenerator,
        accessTokenService: AccessTokenService,
        refreshSessionRepository: RefreshSessionRepository,
        config: ConfigService,
      ) =>
        new RotateRefreshSessionUseCase(
          refreshTokenHasher,
          refreshTokenGenerator,
          accessTokenService,
          refreshSessionRepository,
          {
            refreshTokenLifetimeSeconds: config.getOrThrow<number>(
              'authentication.refreshTokenLifetimeSeconds',
            ),
          },
        ),
    },
    {
      provide: LogoutCurrentSessionUseCase,
      inject: [REFRESH_TOKEN_HASHER, REFRESH_SESSION_REPOSITORY],
      useFactory: (
        refreshTokenHasher: RefreshTokenHasher,
        refreshSessionRepository: RefreshSessionRepository,
      ) => new LogoutCurrentSessionUseCase(refreshTokenHasher, refreshSessionRepository),
    },
    {
      provide: RefreshRequestOriginPolicy,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new RefreshRequestOriginPolicy(config.getOrThrow<string[]>('application.corsOrigins')),
    },
  ],
})
export class AuthModule {}
