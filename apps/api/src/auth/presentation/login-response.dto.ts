import { ApiProperty } from '@nestjs/swagger';
import type { LoginResponse, LoginUser } from '@washqueue/contracts';

class LoginUserDto implements LoginUser {
  @ApiProperty({ format: 'uuid' })
  declare id: string;

  @ApiProperty({ minLength: 2, maxLength: 60 })
  declare firstName: string;

  @ApiProperty({ minLength: 2, maxLength: 60, nullable: true, type: String })
  declare lastName: string | null;

  @ApiProperty({ format: 'email', maxLength: 254 })
  declare email: string;
}

export class LoginResponseDto implements LoginResponse {
  @ApiProperty({ type: LoginUserDto })
  declare user: LoginUserDto;

  @ApiProperty({
    description: 'Short-lived signed access token.',
    example: 'signed-access-token',
  })
  declare accessToken: string;

  @ApiProperty({ format: 'date-time' })
  declare accessTokenExpiresAt: string;
}
