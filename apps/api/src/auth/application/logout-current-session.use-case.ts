import type { RefreshSessionRepository } from './refresh-session.repository.js';
import type { RefreshTokenHasher } from './refresh-token-hasher.js';

const opaqueRefreshTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export interface LogoutCurrentSessionCommand {
  rawRefreshToken: string | undefined;
}

interface LogoutCurrentSessionUseCaseOptions {
  now?: () => Date;
}

export class LogoutCurrentSessionUseCase {
  private readonly now: () => Date;

  constructor(
    private readonly refreshTokenHasher: RefreshTokenHasher,
    private readonly refreshSessionRepository: RefreshSessionRepository,
    options: LogoutCurrentSessionUseCaseOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async execute(command: LogoutCurrentSessionCommand): Promise<void> {
    if (!command.rawRefreshToken || !opaqueRefreshTokenPattern.test(command.rawRefreshToken)) {
      return;
    }

    const tokenHash = this.refreshTokenHasher.hash(command.rawRefreshToken);
    await this.refreshSessionRepository.revokeActiveByTokenHash({
      tokenHash,
      revokedAt: this.now(),
    });
  }
}
