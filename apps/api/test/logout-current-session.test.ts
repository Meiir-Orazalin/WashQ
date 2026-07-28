import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LogoutCurrentSessionUseCase,
  type LogoutCurrentSessionCommand,
} from '../src/auth/application/logout-current-session.use-case.js';
import type { RefreshSessionRepository } from '../src/auth/application/refresh-session.repository.js';
import type {
  RefreshTokenHash,
  RefreshTokenHasher,
} from '../src/auth/application/refresh-token-hasher.js';

const now = new Date('2026-07-28T12:00:00.000Z');
const tokenHash = `sha256:${'h'.repeat(43)}` as RefreshTokenHash;

describe('LogoutCurrentSessionUseCase', () => {
  const hashToken = vi.fn<RefreshTokenHasher['hash']>();
  const verifyToken = vi.fn<RefreshTokenHasher['verify']>();
  const createSession = vi.fn<RefreshSessionRepository['create']>();
  const findSession = vi.fn<RefreshSessionRepository['findByTokenHash']>();
  const revokeSession = vi.fn<RefreshSessionRepository['revoke']>();
  const revokeActiveSessionByTokenHash =
    vi.fn<RefreshSessionRepository['revokeActiveByTokenHash']>();
  const revokeFamily = vi.fn<RefreshSessionRepository['revokeFamily']>();
  const rotateSession = vi.fn<RefreshSessionRepository['rotate']>();

  let rawRefreshToken: string;
  let useCase: LogoutCurrentSessionUseCase;

  beforeEach(() => {
    rawRefreshToken = randomBytes(32).toString('base64url');
    hashToken.mockReset().mockReturnValue(tokenHash);
    verifyToken.mockReset();
    createSession.mockReset();
    findSession.mockReset();
    revokeSession.mockReset();
    revokeActiveSessionByTokenHash.mockReset().mockResolvedValue();
    revokeFamily.mockReset();
    rotateSession.mockReset();

    useCase = new LogoutCurrentSessionUseCase(
      { hash: hashToken, verify: verifyToken },
      {
        create: createSession,
        findByTokenHash: findSession,
        revoke: revokeSession,
        revokeActiveByTokenHash: revokeActiveSessionByTokenHash,
        revokeFamily,
        rotate: rotateSession,
      },
      { now: () => now },
    );
  });

  it('hashes a valid token and conditionally revokes only its matching active session', async () => {
    await expect(useCase.execute({ rawRefreshToken })).resolves.toBeUndefined();

    expect(hashToken).toHaveBeenCalledOnce();
    expect(hashToken).toHaveBeenCalledWith(rawRefreshToken);
    expect(revokeActiveSessionByTokenHash).toHaveBeenCalledOnce();
    expect(revokeActiveSessionByTokenHash).toHaveBeenCalledWith({
      tokenHash,
      revokedAt: now,
    });
    expect(findSession).not.toHaveBeenCalled();
    expect(revokeSession).not.toHaveBeenCalled();
    expect(revokeFamily).not.toHaveBeenCalled();
    expect(rotateSession).not.toHaveBeenCalled();
  });

  it.each([
    { state: 'missing', command: { rawRefreshToken: undefined } },
    { state: 'malformed', command: { rawRefreshToken: 'malformed' } },
  ] satisfies { state: string; command: LogoutCurrentSessionCommand }[])(
    'treats $state token input as an idempotent success before hashing',
    async ({ command }) => {
      await expect(useCase.execute(command)).resolves.toBeUndefined();

      expect(hashToken).not.toHaveBeenCalled();
      expect(revokeActiveSessionByTokenHash).not.toHaveBeenCalled();
    },
  );

  it.each(['unknown', 'expired', 'already-revoked'])(
    'keeps a repository-classified %s session externally successful',
    async () => {
      revokeActiveSessionByTokenHash.mockResolvedValueOnce();

      await expect(useCase.execute({ rawRefreshToken })).resolves.toBeUndefined();

      expect(revokeActiveSessionByTokenHash).toHaveBeenCalledWith({
        tokenHash,
        revokedAt: now,
      });
    },
  );

  it('does not trigger family revocation or affect unrelated sessions for a rotated predecessor', async () => {
    await useCase.execute({ rawRefreshToken });

    expect(revokeActiveSessionByTokenHash).toHaveBeenCalledOnce();
    expect(revokeFamily).not.toHaveBeenCalled();
    expect(revokeSession).not.toHaveBeenCalled();
    expect(rotateSession).not.toHaveBeenCalled();
  });

  it('propagates hashing failure for the sanitized HTTP failure boundary', async () => {
    hashToken.mockImplementationOnce(() => {
      throw new Error('hashing infrastructure failed');
    });

    await expect(useCase.execute({ rawRefreshToken })).rejects.toThrow(
      'hashing infrastructure failed',
    );
    expect(revokeActiveSessionByTokenHash).not.toHaveBeenCalled();
  });

  it('propagates repository failure for the sanitized HTTP failure boundary', async () => {
    revokeActiveSessionByTokenHash.mockRejectedValueOnce(
      new Error('database constraint internal detail'),
    );

    await expect(useCase.execute({ rawRefreshToken })).rejects.toThrow(
      'database constraint internal detail',
    );
  });

  it('returns no raw token or session information', async () => {
    const result = await useCase.execute({ rawRefreshToken });

    expect(result).toBeUndefined();
    expect(JSON.stringify(revokeActiveSessionByTokenHash.mock.calls)).not.toContain(
      rawRefreshToken,
    );
  });
});
