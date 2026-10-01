import { z } from 'zod';
import {
  branchIdParamsSchema,
  branchServiceIdParamsSchema,
  createBranchServiceRequestSchema,
  updateBranchServiceRequestSchema,
  type CreateBranchServiceRequest,
  type UpdateBranchServiceRequest,
} from '@washqueue/contracts';
export class BranchServiceQueryDto {
  static readonly schema = z.strictObject({});
}
export class BranchServiceBranchParamsDto {
  static readonly schema = branchIdParamsSchema;
  declare organizationId: string;
  declare branchId: string;
}
export class BranchServiceParamsDto extends BranchServiceBranchParamsDto {
  static override readonly schema = branchServiceIdParamsSchema;
  declare serviceId: string;
}
export class CreateBranchServiceDto implements CreateBranchServiceRequest {
  static readonly schema = createBranchServiceRequestSchema;
  declare name: string;
  declare description: string | null;
  declare durationMinutes: number;
  declare priceMinor: number;
  declare currency: 'KZT';
}
export class UpdateBranchServiceDto implements UpdateBranchServiceRequest {
  static readonly schema = updateBranchServiceRequestSchema;
  declare name?: string;
  declare description?: string | null;
  declare durationMinutes?: number;
  declare priceMinor?: number;
  declare isActive?: boolean;
}
