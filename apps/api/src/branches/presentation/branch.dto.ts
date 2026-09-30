import {
  createBranchRequestSchema,
  organizationIdParamsSchema,
  branchIdParamsSchema,
  replaceOpeningHoursRequestSchema,
  type CreateBranchRequest,
  type ReplaceOpeningHoursRequest,
} from '@washqueue/contracts';
import { z } from 'zod';
export class BranchQueryDto {
  static readonly schema = z.strictObject({});
}
export class BranchOrganizationParamsDto {
  static readonly schema = organizationIdParamsSchema;
  declare organizationId: string;
}
export class BranchParamsDto {
  static readonly schema = branchIdParamsSchema;
  declare organizationId: string;
  declare branchId: string;
}
export class CreateBranchDto implements CreateBranchRequest {
  static readonly schema = createBranchRequestSchema;
  declare name: string;
  declare city: string;
  declare addressLine: string;
  declare timeZone: string;
}
export class ReplaceOpeningHoursDto implements ReplaceOpeningHoursRequest {
  static readonly schema = replaceOpeningHoursRequestSchema;
  declare openingHours: ReplaceOpeningHoursRequest['openingHours'];
}
