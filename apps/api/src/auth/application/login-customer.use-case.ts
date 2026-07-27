import { loginRequestSchema, type LoginRequest } from '@washqueue/contracts';
import type {
  UserAuthenticationRecord,
  UserRepository,
} from '../../users/application/user-repository.js';
import type { AccessTokenService } from './access-token.service.js';
import type { PasswordHasher } from './password-hasher.js';
import type { RefreshSessionRepository } from './refresh-session.repository.js';
import type { RefreshTokenGenerator } from './refresh-token-generator.js';
import type { RefreshTokenHasher } from './refresh-token-hasher.js';

export interface LoginCustomer {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
}

export interface LoginCustomerResult {
  user: LoginCustomer;
  accessToken: string;
  accessTokenExpiresAt: Date;
  rawRefreshToken: string;
}

interface LoginCustomerUseCaseOptions {
  refreshTokenLifetimeSeconds: number;
  now?: () => Date;
}

export class LoginCustomerUseCase {
  private readonly refreshTokenLifetimeSeconds: number;
  private readonly now: () => Date;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly accessTokenService: AccessTokenService,
    private readonly refreshTokenGenerator: RefreshTokenGenerator,
    private readonly refreshTokenHasher: RefreshTokenHasher,
    private readonly refreshSessionRepository: RefreshSessionRepository,
    options: LoginCustomerUseCaseOptions,
  ) {
    this.refreshTokenLifetimeSeconds = options.refreshTokenLifetimeSeconds;
    this.now = options.now ?? (() => new Date());
  }

  async execute(command: LoginRequest): Promise<LoginCustomerResult> {
    const login = loginRequestSchema.parse(command);
    const authenticationRecord = await this.userRepository.findAuthenticationByEmail(login.email);
    const user = await this.verifyCredentials(login.password, authenticationRecord);

    const accessToken = await this.accessTokenService.issue({ subject: user.id });
    const rawRefreshToken = this.refreshTokenGenerator.generate();
    const tokenHash = this.refreshTokenHasher.hash(rawRefreshToken);
    const refreshTokenExpiresAt = new Date(
      this.now().getTime() + this.refreshTokenLifetimeSeconds * 1_000,
    );

    await this.refreshSessionRepository.create({
      userId: user.id,
      tokenHash,
      expiresAt: refreshTokenExpiresAt,
    });

    return {
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
      rawRefreshToken,
    };
  }

  private async verifyCredentials(
    password: string,
    user: UserAuthenticationRecord | null,
  ): Promise<UserAuthenticationRecord> {
    if (!user) {
      try {
        await this.passwordHasher.verifyDummy(password);
      } catch {
        // The external result remains identical for all credential-related failures.
      }

      throw new InvalidCredentialsError();
    }

    try {
      if (await this.passwordHasher.verify(password, user.passwordHash)) {
        return user;
      }
    } catch {
      throw new InvalidCredentialsError();
    }

    throw new InvalidCredentialsError();
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}
