import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CurrentUserUnavailableError,
  UpdateCurrentUserProfileUseCase,
} from '../src/users/application/update-current-user-profile.use-case.js';
import type { UserRepository } from '../src/users/application/user-repository.js';

const user = {
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Meiir',
  lastName: null,
  email: 'meiir@example.com',
};
describe('UpdateCurrentUserProfileUseCase', () => {
  const repository: UserRepository = {
    create: vi.fn(),
    findPublicById: vi.fn(),
    findAuthenticationByEmail: vi.fn(),
    updateCurrentUserProfile: vi.fn(),
  };
  const useCase = new UpdateCurrentUserProfileUseCase(repository);
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(repository.updateCurrentUserProfile).mockResolvedValue(user);
  });

  it('passes only authenticated identity and normalized mutable values, returning the public projection', async () => {
    const result = await useCase.execute(user.id, { firstName: ' Meiir ', lastName: ' ' });
    expect(repository.updateCurrentUserProfile).toHaveBeenCalledExactlyOnceWith(user.id, {
      firstName: 'Meiir',
      lastName: null,
    });
    expect(result).toEqual(user);
    expect(Object.keys(result).sort()).toEqual(['email', 'firstName', 'id', 'lastName']);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.findPublicById).not.toHaveBeenCalled();
    expect(repository.findAuthenticationByEmail).not.toHaveBeenCalled();
  });
  it.each([{ firstName: 'Meiir' }, { lastName: null }, { lastName: 'Updated' }])(
    'preserves omissions and null clears %#',
    async (patch) => {
      await useCase.execute(user.id, patch);
      expect(repository.updateCurrentUserProfile).toHaveBeenCalledExactlyOnceWith(user.id, patch);
    },
  );
  it('rejects a transport-selected identity before persistence', async () => {
    const input = { firstName: 'Meiir', userId: 'another-user' };
    await expect(useCase.execute(user.id, input)).rejects.toThrow();
    expect(repository.updateCurrentUserProfile).not.toHaveBeenCalled();
  });
  it('returns the controlled authentication-required outcome for race-time deletion', async () => {
    vi.mocked(repository.updateCurrentUserProfile).mockResolvedValue(null);
    await expect(useCase.execute(user.id, { firstName: 'Meiir' })).rejects.toBeInstanceOf(
      CurrentUserUnavailableError,
    );
  });
  it('propagates unexpected infrastructure failures to the sanitized HTTP boundary', async () => {
    const error = new Error('infrastructure failure');
    vi.mocked(repository.updateCurrentUserProfile).mockRejectedValue(error);
    await expect(useCase.execute(user.id, { firstName: 'Meiir' })).rejects.toBe(error);
  });
});
