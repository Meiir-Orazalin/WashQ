import type { RefreshTokenHash } from './refresh-token-hasher.js';

export const REFRESH_SESSION_REPOSITORY = Symbol('REFRESH_SESSION_REPOSITORY');

export interface CreateRefreshSession {
  userId: string;
  tokenHash: RefreshTokenHash;
  expiresAt: Date;
}

export interface RefreshSession {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBySessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RotateRefreshSession {
  sessionId: string;
  presentedTokenHash: RefreshTokenHash;
  expectedUpdatedAt: Date;
  replacementTokenHash: RefreshTokenHash;
  replacementExpiresAt: Date;
  rotatedAt: Date;
}

export type RotateRefreshSessionResult = { status: 'rotated' } | { status: 'stale' };

export interface RefreshSessionRepository {
  create(input: CreateRefreshSession): Promise<RefreshSession>;
  findByTokenHash(tokenHash: RefreshTokenHash): Promise<RefreshSession | null>;
  revoke(sessionId: string, revokedAt: Date): Promise<void>;
  revokeFamily(familyId: string, revokedAt: Date): Promise<void>;
  rotate(input: RotateRefreshSession): Promise<RotateRefreshSessionResult>;
}

export class DuplicateRefreshTokenHashError extends Error {
  constructor() {
    super('A refresh session with this token hash already exists');
    this.name = 'DuplicateRefreshTokenHashError';
  }
}
