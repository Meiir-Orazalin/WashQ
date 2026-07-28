import type { AccessTokenService } from './access-token.service.js';
import type { RefreshSession } from './refresh-session.repository.js';
import type { RefreshSessionRepository } from './refresh-session.repository.js';
import type { RefreshTokenGenerator } from './refresh-token-generator.js';
import type { RefreshTokenHasher } from './refresh-token-hasher.js';

const opaqueRefreshTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export interface RotateRefreshSessionCommand {
  rawRefreshToken: string | undefined;
}

export interface RotateRefreshSessionResult {
  accessToken: string;
  accessTokenExpiresAt: Date;
  rawRefreshToken: string;
}

interface RotateRefreshSessionUseCaseOptions {
  refreshTokenLifetimeSeconds: number;
  now?: () => Date;
}

export class RotateRefreshSessionUseCase {
  private readonly refreshTokenLifetimeSeconds: number;
  private readonly now: () => Date;

  constructor(
    private readonly refreshTokenHasher: RefreshTokenHasher,
    private readonly refreshTokenGenerator: RefreshTokenGenerator,
    private readonly accessTokenService: AccessTokenService,
    private readonly refreshSessionRepository: RefreshSessionRepository,
    options: RotateRefreshSessionUseCaseOptions,
  ) {
    this.refreshTokenLifetimeSeconds = options.refreshTokenLifetimeSeconds;
    this.now = options.now ?? (() => new Date());
  }

  async execute(command: RotateRefreshSessionCommand): Promise<RotateRefreshSessionResult> {
    if (!command.rawRefreshToken || !opaqueRefreshTokenPattern.test(command.rawRefreshToken)) {
      throw new InvalidRefreshSessionError();
    }

    const presentedTokenHash = this.refreshTokenHasher.hash(command.rawRefreshToken);
    const foundSession = await this.refreshSessionRepository.findByTokenHash(presentedTokenHash);
    const rotatedAt = this.now();
    const session = await this.requireUsableSession(foundSession, rotatedAt);

    const rawRefreshToken = this.refreshTokenGenerator.generate();
    const replacementTokenHash = this.refreshTokenHasher.hash(rawRefreshToken);
    const accessToken = await this.accessTokenService.issue({ subject: session.userId });
    const replacementExpiresAt = new Date(
      rotatedAt.getTime() + this.refreshTokenLifetimeSeconds * 1_000,
    );
    const rotation = await this.refreshSessionRepository.rotate({
      sessionId: session.id,
      presentedTokenHash,
      expectedUpdatedAt: session.updatedAt,
      replacementTokenHash,
      replacementExpiresAt,
      rotatedAt,
    });

    if (rotation.status === 'stale') {
      throw new InvalidRefreshSessionError();
    }

    return {
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
      rawRefreshToken,
    };
  }

  private async requireUsableSession(
    session: RefreshSession | null,
    now: Date,
  ): Promise<RefreshSession> {
    if (!session) {
      throw new InvalidRefreshSessionError();
    }

    if (session.replacedBySessionId) {
      await this.refreshSessionRepository.revokeFamily(session.familyId, now);
      throw new InvalidRefreshSessionError();
    }

    if (session.revokedAt || session.expiresAt.getTime() <= now.getTime()) {
      throw new InvalidRefreshSessionError();
    }

    return session;
  }
}

export class InvalidRefreshSessionError extends Error {
  constructor() {
    super('Refresh session is invalid');
    this.name = 'InvalidRefreshSessionError';
  }
}
