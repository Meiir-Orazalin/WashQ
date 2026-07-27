export const REFRESH_TOKEN_HASHER = Symbol('REFRESH_TOKEN_HASHER');

declare const refreshTokenHashBrand: unique symbol;

export type RefreshTokenHash = string & {
  readonly [refreshTokenHashBrand]: true;
};

export interface RefreshTokenHasher {
  hash(token: string): RefreshTokenHash;
  verify(token: string, tokenHash: RefreshTokenHash): boolean;
}

export class RefreshTokenHashingError extends Error {
  constructor() {
    super('Refresh token hashing failed');
    this.name = 'RefreshTokenHashingError';
  }
}
