import { currentUserResponseSchema, type CurrentUserResponse } from '@washqueue/contracts';
import type { PublicUser } from '../../users/application/user-repository.js';

export function mapCurrentUserResponse(user: PublicUser): CurrentUserResponse {
  return currentUserResponseSchema.parse({ user });
}
