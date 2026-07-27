import { registrationResponseSchema, type RegistrationResponse } from '@washqueue/contracts';
import type { RegisteredUser } from '../../users/application/user-repository.js';

export function mapRegistrationResponse(user: RegisteredUser): RegistrationResponse {
  return registrationResponseSchema.parse({
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    },
  });
}
