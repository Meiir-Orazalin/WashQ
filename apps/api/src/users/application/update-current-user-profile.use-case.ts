import {
  updateCurrentUserProfileRequestSchema,
  type UpdateCurrentUserProfileRequest,
} from '@washqueue/contracts';
import type { PublicUser, UserRepository } from './user-repository.js';

export class CurrentUserUnavailableError extends Error {
  constructor() {
    super('Authentication is required');
    this.name = 'CurrentUserUnavailableError';
  }
}

export class UpdateCurrentUserProfileUseCase {
  constructor(private readonly repository: UserRepository) {}

  async execute(userId: string, input: UpdateCurrentUserProfileRequest): Promise<PublicUser> {
    const values = updateCurrentUserProfileRequestSchema.parse(input);
    const user = await this.repository.updateCurrentUserProfile(userId, {
      ...(values.firstName !== undefined ? { firstName: values.firstName } : {}),
      ...(values.lastName !== undefined ? { lastName: values.lastName } : {}),
    });
    if (!user) throw new CurrentUserUnavailableError();
    return user;
  }
}
