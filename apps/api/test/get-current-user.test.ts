import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccessTokenService,
  VerifiedAccessToken,
} from '../src/auth/application/access-token.service.js';
import { InvalidAccessTokenError } from '../src/auth/application/access-token.service.js';
import {
  AuthenticationRequiredError,
  GetCurrentUserUseCase,
} from '../src/auth/application/get-current-user.use-case.js';
import { mapCurrentUserResponse } from '../src/auth/presentation/current-user-response.mapper.js';
import type { PublicUser, UserRepository } from '../src/users/application/user-repository.js';

const accessToken = 'signed-access-token';
const subject = 'df4e7850-e329-4679-91f1-77b409d93f4f';
const verifiedToken: VerifiedAccessToken = {
  subject,
  tokenType: 'access',
  issuedAt: new Date('2026-07-28T10:00:00.000Z'),
  expiresAt: new Date('2026-07-28T10:15:00.000Z'),
};
const publicUser: PublicUser = {
  id: subject,
  firstName: 'Current',
  lastName: 'Values',
  email: 'current@example.com',
};

describe('GetCurrentUserUseCase', () => {
  const issue = vi.fn<AccessTokenService['issue']>();
  const verify = vi.fn<AccessTokenService['verify']>();
  const create = vi.fn<UserRepository['create']>();
  const findAuthenticationByEmail = vi.fn<UserRepository['findAuthenticationByEmail']>();
  const findPublicById = vi.fn<UserRepository['findPublicById']>();
  let useCase: GetCurrentUserUseCase;

  beforeEach(() => {
    issue.mockReset();
    verify.mockReset().mockResolvedValue(verifiedToken);
    create.mockReset();
    findAuthenticationByEmail.mockReset();
    findPublicById.mockReset().mockResolvedValue(publicUser);
    useCase = new GetCurrentUserUseCase(
      { issue, verify },
      { create, findAuthenticationByEmail, findPublicById },
    );
  });

  it('returns the current public user after access-token verification', async () => {
    await expect(useCase.execute({ accessToken })).resolves.toEqual(publicUser);
  });

  it('passes only the verified subject to the public user lookup', async () => {
    await useCase.execute({ accessToken });

    expect(verify).toHaveBeenCalledWith(accessToken);
    expect(findPublicById).toHaveBeenCalledWith(subject);
    expect(findAuthenticationByEmail).not.toHaveBeenCalled();
  });

  it('returns current database values rather than mutable token claims', async () => {
    verify.mockResolvedValueOnce({
      ...verifiedToken,
      email: 'stale@example.com',
      firstName: 'Stale',
    } as VerifiedAccessToken);

    await expect(useCase.execute({ accessToken })).resolves.toEqual(publicUser);
  });

  it('rejects a missing token before verification or lookup', async () => {
    await expect(useCase.execute({ accessToken: undefined })).rejects.toBeInstanceOf(
      AuthenticationRequiredError,
    );
    expect(verify).not.toHaveBeenCalled();
    expect(findPublicById).not.toHaveBeenCalled();
  });

  it.each(['invalid token', 'expired token', 'wrong token type'])(
    'returns the same authentication error for an %s',
    async () => {
      verify.mockRejectedValueOnce(new InvalidAccessTokenError());

      await expect(useCase.execute({ accessToken })).rejects.toEqual(
        new AuthenticationRequiredError(),
      );
      expect(findPublicById).not.toHaveBeenCalled();
    },
  );

  it('returns the same authentication error for an invalid subject', async () => {
    verify.mockResolvedValueOnce({ ...verifiedToken, subject: 'not-a-uuid' });

    await expect(useCase.execute({ accessToken })).rejects.toEqual(
      new AuthenticationRequiredError(),
    );
    expect(findPublicById).not.toHaveBeenCalled();
  });

  it('returns the same authentication error when the user was deleted', async () => {
    findPublicById.mockResolvedValueOnce(null);

    await expect(useCase.execute({ accessToken })).rejects.toEqual(
      new AuthenticationRequiredError(),
    );
  });

  it('propagates an unexpected user lookup failure', async () => {
    findPublicById.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(useCase.execute({ accessToken })).rejects.toThrow('database unavailable');
  });

  it('propagates an unexpected token-service failure', async () => {
    verify.mockRejectedValueOnce(new Error('unexpected verifier failure'));

    await expect(useCase.execute({ accessToken })).rejects.toThrow('unexpected verifier failure');
  });

  it('maps a response without credentials, claims, or session data', async () => {
    const response = mapCurrentUserResponse(await useCase.execute({ accessToken }));
    const serialized = JSON.stringify(response);

    expect(response).toEqual({ user: publicUser });
    expect(serialized).not.toMatch(
      /password|accessToken|refreshToken|tokenType|issuedAt|expiresAt|session|role/i,
    );
  });
});
