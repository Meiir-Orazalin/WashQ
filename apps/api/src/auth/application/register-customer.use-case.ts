import { registrationRequestSchema, type RegistrationRequest } from '@washqueue/contracts';
import type { PasswordHasher } from './password-hasher.js';
import type { RegisteredUser, UserRepository } from '../../users/application/user-repository.js';

export class RegisterCustomerUseCase {
  constructor(
    private readonly passwordHasher: PasswordHasher,
    private readonly userRepository: UserRepository,
  ) {}

  async execute(command: RegistrationRequest): Promise<RegisteredUser> {
    const registration = registrationRequestSchema.parse(command);
    const passwordHash = await this.passwordHasher.hash(registration.password);

    return this.userRepository.create({
      firstName: registration.firstName,
      lastName: registration.lastName ?? null,
      email: registration.email,
      passwordHash,
    });
  }
}
