import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  createOrganizationRequestSchema,
  organizationIdParamsSchema,
  type CreateOrganizationRequest,
  type OrganizationIdParams,
} from '@washqueue/contracts';
import { z } from 'zod';

export class OrganizationQueryDto {
  static readonly schema = z.strictObject({});
}
export class OrganizationIdParamsDto implements OrganizationIdParams {
  static readonly schema = organizationIdParamsSchema;
  @ApiProperty({ format: 'uuid' }) declare organizationId: string;
}
export class CreateOrganizationRequestDto implements CreateOrganizationRequest {
  static readonly schema = createOrganizationRequestSchema;
  @ApiProperty({ minLength: 2, maxLength: 120 }) declare name: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 }) declare description:
    string | null;
}
