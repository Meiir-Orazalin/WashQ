import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidAccessTokenError } from '../src/auth/application/access-token.service.js';
import { JoseAccessTokenService } from '../src/auth/infrastructure/jose-access-token.service.js';

const subject = 'df4e7850-e329-4679-91f1-77b409d93f4f';
const signingSecret = 's'.repeat(48);
const initialTime = new Date('2026-07-27T12:00:00.000Z');

describe('JoseAccessTokenService', () => {
  let now: Date;
  let service: JoseAccessTokenService;

  beforeEach(() => {
    now = initialTime;
    service = new JoseAccessTokenService({
      signingSecret,
      lifetimeSeconds: 900,
      now: () => now,
    });
  });

  it('issues a signed access token with an explicit expiration', async () => {
    const issued = await service.issue({ subject });

    expect(issued.token).toBeTruthy();
    expect(issued.expiresAt).toEqual(new Date('2026-07-27T12:15:00.000Z'));
  });

  it('verifies a valid access token into a framework-independent payload', async () => {
    const issued = await service.issue({ subject });

    await expect(service.verify(issued.token)).resolves.toEqual({
      subject,
      tokenType: 'access',
      issuedAt: initialTime,
      expiresAt: new Date('2026-07-27T12:15:00.000Z'),
    });
  });

  it('rejects an expired access token', async () => {
    const issued = await service.issue({ subject });
    now = new Date('2026-07-27T12:15:01.000Z');

    await expect(service.verify(issued.token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a token with an invalid signature', async () => {
    const otherService = new JoseAccessTokenService({
      signingSecret: 'x'.repeat(48),
      lifetimeSeconds: 900,
      now: () => now,
    });
    const issued = await otherService.issue({ subject });

    await expect(service.verify(issued.token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a signed token with the wrong token type', async () => {
    const issuedAt = Math.floor(initialTime.getTime() / 1_000);
    const token = await new SignJWT({ tokenType: 'refresh' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(subject)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 900)
      .sign(new TextEncoder().encode(signingSecret));

    await expect(service.verify(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('includes only the minimum identity claims', async () => {
    const issued = await service.issue({ subject });
    const encodedPayload = issued.token.split('.')[1];

    if (!encodedPayload) {
      throw new Error('Issued token did not contain a payload');
    }

    const payload: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));

    expect(payload).toEqual({
      sub: subject,
      tokenType: 'access',
      iat: Math.floor(initialTime.getTime() / 1_000),
      exp: Math.floor(initialTime.getTime() / 1_000) + 900,
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /email|firstName|lastName|password|role|organization|vehicle/i,
    );
  });
});
