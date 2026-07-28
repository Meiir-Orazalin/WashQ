import { ApiProperty } from '@nestjs/swagger';
import type { CurrentUserResponse } from '@washqueue/contracts';

type CurrentUser = CurrentUserResponse['user'];

class CurrentUserDto implements CurrentUser {
  @ApiProperty({ format: 'uuid' })
  declare id: string;

  @ApiProperty({ minLength: 2, maxLength: 60 })
  declare firstName: string;

  @ApiProperty({ minLength: 2, maxLength: 60, nullable: true, type: String })
  declare lastName: string | null;

  @ApiProperty({ format: 'email', maxLength: 254 })
  declare email: string;
}

export class CurrentUserResponseDto implements CurrentUserResponse {
  @ApiProperty({ type: CurrentUserDto })
  declare user: CurrentUserDto;
}
