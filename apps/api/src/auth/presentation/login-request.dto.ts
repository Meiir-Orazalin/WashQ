import { ApiProperty } from '@nestjs/swagger';
import { loginRequestSchema, type LoginRequest } from '@washqueue/contracts';

export class LoginRequestDto implements LoginRequest {
  static readonly schema = loginRequestSchema;

  @ApiProperty({
    format: 'email',
    maxLength: 254,
  })
  declare email: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 128,
    writeOnly: true,
  })
  declare password: string;
}
