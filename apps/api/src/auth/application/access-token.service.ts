export const ACCESS_TOKEN_SERVICE = Symbol('ACCESS_TOKEN_SERVICE');

export interface IssueAccessToken {
  subject: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}

export interface VerifiedAccessToken {
  subject: string;
  tokenType: 'access';
  issuedAt: Date;
  expiresAt: Date;
}

export interface AccessTokenService {
  issue(input: IssueAccessToken): Promise<IssuedAccessToken>;
  verify(token: string): Promise<VerifiedAccessToken>;
}

export class AccessTokenIssuanceError extends Error {
  constructor() {
    super('Access token issuance failed');
    this.name = 'AccessTokenIssuanceError';
  }
}

export class InvalidAccessTokenError extends Error {
  constructor() {
    super('Access token is invalid');
    this.name = 'InvalidAccessTokenError';
  }
}
