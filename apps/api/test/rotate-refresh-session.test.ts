import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessTokenService } from '../src/auth/application/access-token.service.js';
import {
  InvalidRefreshSessionError,
  RotateRefreshSessionUseCase,
} from '../src/auth/application/rotate-refresh-session.use-case.js';
import type {
  RefreshSession,
  RefreshSessionRepository,
} from '../src/auth/application/refresh-session.repository.js';
import type { RefreshTokenGenerator } from '../src/auth/application/refresh-token-generator.js';
import type {
  RefreshTokenHash,
  RefreshTokenHasher,
} from '../src/auth/application/refresh-token-hasher.js';
import { mapRefreshResponse } from '../src/auth/presentation/refresh-response.mapper.js';

const now = new Date('2026-07-27T12:00:00.000Z');
const session: RefreshSession = {
  id: '9bb9aedc-8dc8-409f-86ee-d6be41e71493',
  userId: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  familyId: '8ca97bb3-06dc-4f9a-ab8b-fbf4244ae415',
  expiresAt: new Date('2026-08-26T12:00:00.000Z'),
  revokedAt: null,
  replacedBySessionId: null,
  createdAt: new Date('2026-07-27T11:00:00.000Z'),
  updatedAt: new Date('2026-07-27T11:00:00.000Z'),
};
const issuedAccessToken = {
  token: 'signed-access-token',
  expiresAt: new Date('2026-07-27T12:15:00.000Z'),
};
const presentedTokenHash = `sha256:${'p'.repeat(43)}` as RefreshTokenHash;
const replacementTokenHash = `sha256:${'r'.repeat(43)}` as RefreshTokenHash;

describe('RotateRefreshSessionUseCase', () => {
  const hashToken = vi.fn<RefreshTokenHasher['hash']>();
  const verifyToken = vi.fn<RefreshTokenHasher['verify']>();
  const generateToken = vi.fn<RefreshTokenGenerator['generate']>();
  const issueAccessToken = vi.fn<AccessTokenService['issue']>();
  const verifyAccessToken = vi.fn<AccessTokenService['verify']>();
  const createSession = vi.fn<RefreshSessionRepository['create']>();
  const findSession = vi.fn<RefreshSessionRepository['findByTokenHash']>();
  const revokeSession = vi.fn<RefreshSessionRepository['revoke']>();
  const revokeActiveSessionByTokenHash =
    vi.fn<RefreshSessionRepository['revokeActiveByTokenHash']>();
  const revokeFamily = vi.fn<RefreshSessionRepository['revokeFamily']>();
  const rotateSession = vi.fn<RefreshSessionRepository['rotate']>();

  let presentedRawToken: string;
  let replacementRawToken: string;
  let useCase: RotateRefreshSessionUseCase;

  beforeEach(() => {
    presentedRawToken = randomBytes(32).toString('base64url');
    replacementRawToken = randomBytes(32).toString('base64url');
    hashToken
      .mockReset()
      .mockReturnValueOnce(presentedTokenHash)
      .mockReturnValueOnce(replacementTokenHash);
    verifyToken.mockReset();
    generateToken.mockReset().mockReturnValue(replacementRawToken);
    issueAccessToken.mockReset().mockResolvedValue(issuedAccessToken);
    verifyAccessToken.mockReset();
    createSession.mockReset();
    findSession.mockReset().mockResolvedValue(session);
    revokeSession.mockReset();
    revokeActiveSessionByTokenHash.mockReset();
    revokeFamily.mockReset().mockResolvedValue();
    rotateSession.mockReset().mockResolvedValue({ status: 'rotated' });

    useCase = new RotateRefreshSessionUseCase(
      { hash: hashToken, verify: verifyToken },
      { generate: generateToken },
      { issue: issueAccessToken, verify: verifyAccessToken },
      {
        create: createSession,
        findByTokenHash: findSession,
        revoke: revokeSession,
        revokeActiveByTokenHash: revokeActiveSessionByTokenHash,
        revokeFamily,
        rotate: rotateSession,
      },
      { refreshTokenLifetimeSeconds: 2_592_000, now: () => now },
    );
  });

  it('rotates a valid session and returns newly issued credentials', async () => {
    await expect(useCase.execute({ rawRefreshToken: presentedRawToken })).resolves.toEqual({
      accessToken: issuedAccessToken.token,
      accessTokenExpiresAt: issuedAccessToken.expiresAt,
      rawRefreshToken: replacementRawToken,
    });
  });

  it('hashes the presented token before session lookup', async () => {
    await useCase.execute({ rawRefreshToken: presentedRawToken });

    expect(hashToken).toHaveBeenNthCalledWith(1, presentedRawToken);
    expect(findSession).toHaveBeenCalledWith(presentedTokenHash);
  });

  it('hashes the new token and atomically replaces the old session once', async () => {
    await useCase.execute({ rawRefreshToken: presentedRawToken });

    expect(generateToken).toHaveBeenCalledOnce();
    expect(hashToken).toHaveBeenNthCalledWith(2, replacementRawToken);
    expect(rotateSession).toHaveBeenCalledOnce();
    expect(rotateSession).toHaveBeenCalledWith({
      sessionId: session.id,
      presentedTokenHash,
      expectedUpdatedAt: session.updatedAt,
      replacementTokenHash,
      replacementExpiresAt: new Date('2026-08-26T12:00:00.000Z'),
      rotatedAt: now,
    });
    expect(JSON.stringify(rotateSession.mock.calls)).not.toContain(replacementRawToken);
  });

  it('issues a new access token for only the owning user subject', async () => {
    await useCase.execute({ rawRefreshToken: presentedRawToken });

    expect(issueAccessToken).toHaveBeenCalledWith({ subject: session.userId });
  });

  it('rejects a missing token before hashing or lookup', async () => {
    await expect(useCase.execute({ rawRefreshToken: undefined })).rejects.toBeInstanceOf(
      InvalidRefreshSessionError,
    );
    expect(hashToken).not.toHaveBeenCalled();
    expect(findSession).not.toHaveBeenCalled();
  });

  it('rejects a malformed token before lookup', async () => {
    await expect(useCase.execute({ rawRefreshToken: 'malformed' })).rejects.toBeInstanceOf(
      InvalidRefreshSessionError,
    );
    expect(findSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown session', async () => {
    findSession.mockResolvedValueOnce(null);

    await expect(useCase.execute({ rawRefreshToken: presentedRawToken })).rejects.toBeInstanceOf(
      InvalidRefreshSessionError,
    );
    expect(rotateSession).not.toHaveBeenCalled();
  });

  it('rejects an expired session', async () => {
    findSession.mockResolvedValueOnce({ ...session, expiresAt: now });

    await expect(useCase.execute({ rawRefreshToken: presentedRawToken })).rejects.toBeInstanceOf(
      InvalidRefreshSessionError,
    );
    expect(rotateSession).not.toHaveBeenCalled();
  });

  it('rejects a normally revoked session without revoking its family', async () => {
    findSession.mockResolvedValueOnce({ ...session, revokedAt: now });

    await expect(useCase.execute({ rawRefreshToken: presentedRawToken })).rejects.toBeInstanceOf(
      InvalidRefreshSessionError,
    );
    expect(revokeFamily).not.toHaveBeenCalled();
    expect(rotateSession).not.toHaveBeenCalled();
  });

  it('treats a replaced session as replay and revokes only its family', async () => {
    findSession.mockResolvedValueOnce({
      ...session,
      revokedAt: now,
      replacedBySessionId: '1c4a784e-18cf-4857-b7fc-c41816b3af8a',
    });

    await expect(useCase.execute({ rawRefreshToken: presentedRawToken })).rejects.toBeInstanceOf(
      InvalidRefreshSessionError,
    );
    expect(revokeFamily).toHaveBeenCalledWith(session.familyId, now);
    expect(revokeFamily).toHaveBeenCalledOnce();
    expect(issueAccessToken).not.toHaveBeenCalled();
    expect(rotateSession).not.toHaveBeenCalled();
  });

  it('rejects an atomic stale result without returning generated credentials', async () => {
    rotateSession.mockResolvedValueOnce({ status: 'stale' });

    await expect(useCase.execute({ rawRefreshToken: presentedRawToken })).rejects.toBeInstanceOf(
      InvalidRefreshSessionError,
    );
  });

  it('does not rotate when replacement-token generation fails', async () => {
    generateToken.mockImplementationOnce(() => {
      throw new Error('random source failed');
    });

    await expect(useCase.execute({ rawRefreshToken: presentedRawToken })).rejects.toThrow(
      'random source failed',
    );
    expect(issueAccessToken).not.toHaveBeenCalled();
    expect(rotateSession).not.toHaveBeenCalled();
  });

  it('does not rotate when replacement-token hashing fails', async () => {
    hashToken
      .mockReset()
      .mockReturnValueOnce(presentedTokenHash)
      .mockImplementationOnce(() => {
        throw new Error('hashing failed');
      });

    await expect(useCase.execute({ rawRefreshToken: presentedRawToken })).rejects.toThrow(
      'hashing failed',
    );
    expect(issueAccessToken).not.toHaveBeenCalled();
    expect(rotateSession).not.toHaveBeenCalled();
  });

  it('does not rotate when access-token issuance fails', async () => {
    issueAccessToken.mockRejectedValueOnce(new Error('signing failed'));

    await expect(useCase.execute({ rawRefreshToken: presentedRawToken })).rejects.toThrow(
      'signing failed',
    );
    expect(rotateSession).not.toHaveBeenCalled();
  });

  it('does not return credentials when atomic persistence fails', async () => {
    rotateSession.mockRejectedValueOnce(new Error('database transaction failed'));

    await expect(useCase.execute({ rawRefreshToken: presentedRawToken })).rejects.toThrow(
      'database transaction failed',
    );
  });

  it('maps JSON without refresh or session information', async () => {
    const result = await useCase.execute({ rawRefreshToken: presentedRawToken });
    const response = mapRefreshResponse(result);
    const serialized = JSON.stringify(response);

    expect(response).toEqual({
      accessToken: issuedAccessToken.token,
      accessTokenExpiresAt: issuedAccessToken.expiresAt.toISOString(),
    });
    expect(serialized).not.toContain(replacementRawToken);
    expect(serialized).not.toMatch(/refreshToken|sessionId|familyId|tokenHash/i);
  });
});
