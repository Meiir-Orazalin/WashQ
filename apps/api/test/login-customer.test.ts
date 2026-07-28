import { randomBytes } from 'node:crypto';
import type { LoginRequest } from '@washqueue/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessTokenService } from '../src/auth/application/access-token.service.js';
import {
  InvalidCredentialsError,
  LoginCustomerUseCase,
} from '../src/auth/application/login-customer.use-case.js';
import type { PasswordHasher } from '../src/auth/application/password-hasher.js';
import type { RefreshSessionRepository } from '../src/auth/application/refresh-session.repository.js';
import type { RefreshTokenGenerator } from '../src/auth/application/refresh-token-generator.js';
import type {
  RefreshTokenHash,
  RefreshTokenHasher,
} from '../src/auth/application/refresh-token-hasher.js';
import { mapLoginResponse } from '../src/auth/presentation/login-response.mapper.js';
import type {
  UserAuthenticationRecord,
  UserRepository,
} from '../src/users/application/user-repository.js';

const login: LoginRequest = {
  email: 'meiir@example.com',
  password: 'example-password',
};

const authenticationRecord: UserAuthenticationRecord = {
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Meiir',
  lastName: 'Orazalin',
  email: 'meiir@example.com',
  passwordHash: '$argon2id$stored-password-hash',
};

const issuedAccessToken = {
  token: 'signed-access-token',
  expiresAt: new Date('2026-07-27T12:15:00.000Z'),
};
const now = new Date('2026-07-27T12:00:00.000Z');
const refreshTokenHash = `sha256:${'h'.repeat(43)}` as RefreshTokenHash;

describe('LoginCustomerUseCase', () => {
  const createUser = vi.fn<UserRepository['create']>();
  const findAuthenticationByEmail = vi.fn<UserRepository['findAuthenticationByEmail']>();
  const hashPassword = vi.fn<PasswordHasher['hash']>();
  const verifyPassword = vi.fn<PasswordHasher['verify']>();
  const verifyDummy = vi.fn<PasswordHasher['verifyDummy']>();
  const issueAccessToken = vi.fn<AccessTokenService['issue']>();
  const verifyAccessToken = vi.fn<AccessTokenService['verify']>();
  const generateRefreshToken = vi.fn<RefreshTokenGenerator['generate']>();
  const hashRefreshToken = vi.fn<RefreshTokenHasher['hash']>();
  const verifyRefreshToken = vi.fn<RefreshTokenHasher['verify']>();
  const createSession = vi.fn<RefreshSessionRepository['create']>();
  const findSession = vi.fn<RefreshSessionRepository['findByTokenHash']>();
  const revokeSession = vi.fn<RefreshSessionRepository['revoke']>();
  const revokeActiveSessionByTokenHash =
    vi.fn<RefreshSessionRepository['revokeActiveByTokenHash']>();
  const revokeFamily = vi.fn<RefreshSessionRepository['revokeFamily']>();
  const rotateSession = vi.fn<RefreshSessionRepository['rotate']>();

  let rawRefreshToken: string;
  let useCase: LoginCustomerUseCase;

  beforeEach(() => {
    rawRefreshToken = randomBytes(32).toString('base64url');
    createUser.mockReset();
    findAuthenticationByEmail.mockReset().mockResolvedValue(authenticationRecord);
    hashPassword.mockReset();
    verifyPassword.mockReset().mockResolvedValue(true);
    verifyDummy.mockReset().mockResolvedValue();
    issueAccessToken.mockReset().mockResolvedValue(issuedAccessToken);
    verifyAccessToken.mockReset();
    generateRefreshToken.mockReset().mockReturnValue(rawRefreshToken);
    hashRefreshToken.mockReset().mockReturnValue(refreshTokenHash);
    verifyRefreshToken.mockReset();
    createSession.mockReset().mockResolvedValue({
      id: '9bb9aedc-8dc8-409f-86ee-d6be41e71493',
      userId: authenticationRecord.id,
      familyId: '8ca97bb3-06dc-4f9a-ab8b-fbf4244ae415',
      expiresAt: new Date('2026-08-26T12:00:00.000Z'),
      revokedAt: null,
      replacedBySessionId: null,
      createdAt: now,
      updatedAt: now,
    });
    findSession.mockReset();
    revokeSession.mockReset();
    revokeActiveSessionByTokenHash.mockReset();
    revokeFamily.mockReset();
    rotateSession.mockReset();

    useCase = new LoginCustomerUseCase(
      { create: createUser, findAuthenticationByEmail },
      { hash: hashPassword, verify: verifyPassword, verifyDummy },
      { issue: issueAccessToken, verify: verifyAccessToken },
      { generate: generateRefreshToken },
      { hash: hashRefreshToken, verify: verifyRefreshToken },
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

  it('logs in a customer and returns the public user and issued access token', async () => {
    const result = await useCase.execute(login);

    expect(result).toMatchObject({
      user: {
        id: authenticationRecord.id,
        firstName: 'Meiir',
        lastName: 'Orazalin',
        email: 'meiir@example.com',
      },
      accessToken: issuedAccessToken.token,
      accessTokenExpiresAt: issuedAccessToken.expiresAt,
    });
  });

  it('normalizes the email before repository lookup', async () => {
    await useCase.execute({ ...login, email: ' Meiir@Example.COM ' });

    expect(findAuthenticationByEmail).toHaveBeenCalledWith('meiir@example.com');
  });

  it('passes the unmodified password and internal hash to password verification', async () => {
    const password = ' password with spaces ';

    await useCase.execute({ ...login, password });

    expect(verifyPassword).toHaveBeenCalledWith(password, authenticationRecord.passwordHash);
  });

  it('uses dummy password verification and returns invalid credentials for an unknown email', async () => {
    findAuthenticationByEmail.mockResolvedValueOnce(null);

    await expect(useCase.execute(login)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(verifyDummy).toHaveBeenCalledWith(login.password);
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('returns the same invalid-credentials error for a wrong password', async () => {
    verifyPassword.mockResolvedValueOnce(false);

    const unknownEmailError = await captureError(async () => {
      findAuthenticationByEmail.mockResolvedValueOnce(null);
      await useCase.execute(login);
    });
    const wrongPasswordError = await captureError(() => useCase.execute(login));

    expect(unknownEmailError).toEqual(wrongPasswordError);
    expect(unknownEmailError).toEqual({
      name: 'InvalidCredentialsError',
      message: 'Invalid credentials',
    });
  });

  it('treats password-verifier failures as invalid credentials', async () => {
    verifyPassword.mockRejectedValueOnce(new Error('argon2 internal detail'));

    await expect(useCase.execute(login)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('passes only the user subject to access-token issuance', async () => {
    await useCase.execute(login);

    expect(issueAccessToken).toHaveBeenCalledWith({ subject: authenticationRecord.id });
    expect(JSON.stringify(issueAccessToken.mock.calls)).not.toMatch(
      /email|firstName|lastName|password|role|organization|vehicle/i,
    );
  });

  it('hashes the raw refresh token and persists only its branded hash', async () => {
    await useCase.execute(login);

    expect(hashRefreshToken).toHaveBeenCalledWith(rawRefreshToken);
    expect(createSession).toHaveBeenCalledWith({
      userId: authenticationRecord.id,
      tokenHash: refreshTokenHash,
      expiresAt: new Date('2026-08-26T12:00:00.000Z'),
    });
    expect(JSON.stringify(createSession.mock.calls)).not.toContain(rawRefreshToken);
  });

  it('allows multiple logins to create multiple sessions', async () => {
    await useCase.execute(login);
    await useCase.execute(login);

    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it('does not issue tokens or create a session for invalid credentials', async () => {
    verifyPassword.mockResolvedValueOnce(false);

    await expect(useCase.execute(login)).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(issueAccessToken).not.toHaveBeenCalled();
    expect(generateRefreshToken).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('does not generate a refresh token or create a session after access-token failure', async () => {
    issueAccessToken.mockRejectedValueOnce(new Error('token signing failed'));

    await expect(useCase.execute(login)).rejects.toThrow('token signing failed');
    expect(generateRefreshToken).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('does not create a session after refresh-token generation failure', async () => {
    generateRefreshToken.mockImplementationOnce(() => {
      throw new Error('random source failed');
    });

    await expect(useCase.execute(login)).rejects.toThrow('random source failed');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('does not create a session after refresh-token hashing failure', async () => {
    hashRefreshToken.mockImplementationOnce(() => {
      throw new Error('hashing failed');
    });

    await expect(useCase.execute(login)).rejects.toThrow('hashing failed');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('maps JSON without password, password hash, refresh token, or session data', async () => {
    const response = mapLoginResponse(await useCase.execute(login));
    const serialized = JSON.stringify(response);

    expect(response.user).not.toHaveProperty('passwordHash');
    expect(response).not.toHaveProperty('rawRefreshToken');
    expect(response).not.toHaveProperty('refreshToken');
    expect(serialized).not.toContain(authenticationRecord.passwordHash);
    expect(serialized).not.toContain(rawRefreshToken);
    expect(serialized).not.toMatch(/sessionId|tokenHash/i);
  });
});

async function captureError(operation: () => Promise<unknown>): Promise<{
  name: string;
  message: string;
}> {
  try {
    await operation();
    throw new Error('Expected operation to fail');
  } catch (error) {
    if (!(error instanceof InvalidCredentialsError)) {
      throw error;
    }

    return { name: error.name, message: error.message };
  }
}
