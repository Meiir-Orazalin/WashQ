import { registrationRequestSchema, type RegistrationRequest } from '@washqueue/contracts';

export class RegisterRequestDto implements RegistrationRequest {
  static readonly schema = registrationRequestSchema;

  declare firstName: string;
  declare lastName?: string | null;
  declare email: string;
  declare password: string;
}
