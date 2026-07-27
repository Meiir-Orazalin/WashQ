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
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefreshSessionRepository {
  create(input: CreateRefreshSession): Promise<RefreshSession>;
  findByTokenHash(tokenHash: RefreshTokenHash): Promise<RefreshSession | null>;
  revoke(sessionId: string, revokedAt: Date): Promise<void>;
}

export class DuplicateRefreshTokenHashError extends Error {
  constructor() {
    super('A refresh session with this token hash already exists');
    this.name = 'DuplicateRefreshTokenHashError';
  }
}
