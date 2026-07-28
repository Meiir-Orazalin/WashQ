import { z } from 'zod';
import type { PublicUser, UserRepository } from '../../users/application/user-repository.js';
import { InvalidAccessTokenError, type AccessTokenService } from './access-token.service.js';

const userIdSchema = z.uuid();

export interface GetCurrentUserCommand {
  accessToken: string | undefined;
}

export class GetCurrentUserUseCase {
  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly userRepository: UserRepository,
  ) {}

  async execute(command: GetCurrentUserCommand): Promise<PublicUser> {
    if (!command.accessToken) {
      throw new AuthenticationRequiredError();
    }

    let subject: string;
    try {
      subject = (await this.accessTokenService.verify(command.accessToken)).subject;
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        throw new AuthenticationRequiredError();
      }

      throw error;
    }

    if (!userIdSchema.safeParse(subject).success) {
      throw new AuthenticationRequiredError();
    }

    const user = await this.userRepository.findPublicById(subject);
    if (!user) {
      throw new AuthenticationRequiredError();
    }

    return user;
  }
}

export class AuthenticationRequiredError extends Error {
  constructor() {
    super('Authentication is required');
    this.name = 'AuthenticationRequiredError';
  }
}
