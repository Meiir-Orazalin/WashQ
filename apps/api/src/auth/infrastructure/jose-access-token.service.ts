import { SignJWT, jwtVerify } from 'jose';
import {
  AccessTokenIssuanceError,
  InvalidAccessTokenError,
  type AccessTokenService,
  type IssueAccessToken,
  type IssuedAccessToken,
  type VerifiedAccessToken,
} from '../application/access-token.service.js';

const accessTokenAlgorithm = 'HS256';

interface JoseAccessTokenServiceOptions {
  signingSecret: string;
  lifetimeSeconds: number;
  now?: () => Date;
}

export class JoseAccessTokenService implements AccessTokenService {
  private readonly key: Uint8Array;
  private readonly lifetimeSeconds: number;
  private readonly now: () => Date;

  constructor(options: JoseAccessTokenServiceOptions) {
    this.key = new TextEncoder().encode(options.signingSecret);
    this.lifetimeSeconds = options.lifetimeSeconds;
    this.now = options.now ?? (() => new Date());
  }

  async issue(input: IssueAccessToken): Promise<IssuedAccessToken> {
    if (!input.subject) {
      throw new AccessTokenIssuanceError();
    }

    const issuedAtSeconds = Math.floor(this.now().getTime() / 1_000);
    const expiresAtSeconds = issuedAtSeconds + this.lifetimeSeconds;

    try {
      const token = await new SignJWT({ tokenType: 'access' })
        .setProtectedHeader({ alg: accessTokenAlgorithm, typ: 'JWT' })
        .setSubject(input.subject)
        .setIssuedAt(issuedAtSeconds)
        .setExpirationTime(expiresAtSeconds)
        .sign(this.key);

      return {
        token,
        expiresAt: new Date(expiresAtSeconds * 1_000),
      };
    } catch {
      throw new AccessTokenIssuanceError();
    }
  }

  async verify(token: string): Promise<VerifiedAccessToken> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [accessTokenAlgorithm],
        currentDate: this.now(),
      });

      if (
        payload.tokenType !== 'access' ||
        typeof payload.sub !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number' ||
        payload.exp <= payload.iat
      ) {
        throw new InvalidAccessTokenError();
      }

      return {
        subject: payload.sub,
        tokenType: 'access',
        issuedAt: new Date(payload.iat * 1_000),
        expiresAt: new Date(payload.exp * 1_000),
      };
    } catch {
      throw new InvalidAccessTokenError();
    }
  }
}
