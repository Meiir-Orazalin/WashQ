import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  updateCurrentUserProfileRequestSchema,
  type UpdateCurrentUserProfileRequest,
} from '@washqueue/contracts';
import { z } from 'zod';

export class UpdateProfileRequestDto implements UpdateCurrentUserProfileRequest {
  static readonly schema = updateCurrentUserProfileRequestSchema;

  @ApiPropertyOptional({
    minLength: 2,
    maxLength: 60,
    description: 'Trimmed; casing preserved. Cannot be null. Omitted retains the current value.',
  })
  declare firstName?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 2,
    maxLength: 60,
    description:
      'Trimmed; casing preserved. Null or blank clears. Omitted retains the current value.',
  })
  declare lastName?: string | null;
}

/** This endpoint accepts no query parameters, especially no client-selected identity. */
export class ProfileQueryDto {
  static readonly schema = z.strictObject({});
}
