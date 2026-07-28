import { ApiProperty } from '@nestjs/swagger';
import type { RefreshResponse } from '@washqueue/contracts';

export class RefreshResponseDto implements RefreshResponse {
  @ApiProperty({
    description: 'New short-lived signed access token.',
    example: 'signed-access-token',
  })
  declare accessToken: string;

  @ApiProperty({ format: 'date-time' })
  declare accessTokenExpiresAt: string;
}
