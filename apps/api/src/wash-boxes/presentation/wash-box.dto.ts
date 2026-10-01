import {
  branchIdParamsSchema,
  washBoxIdParamsSchema,
  createWashBoxRequestSchema,
  setWashBoxActiveStateRequestSchema,
  type CreateWashBoxRequest,
  type SetWashBoxActiveStateRequest,
} from '@washqueue/contracts';
import { z } from 'zod';
export class WashBoxQueryDto {
  static readonly schema = z.strictObject({});
}
export class WashBoxBranchParamsDto {
  static readonly schema = branchIdParamsSchema;
  declare organizationId: string;
  declare branchId: string;
}
export class WashBoxParamsDto extends WashBoxBranchParamsDto {
  static override readonly schema = washBoxIdParamsSchema;
  declare washBoxId: string;
}
export class CreateWashBoxDto implements CreateWashBoxRequest {
  static readonly schema = createWashBoxRequestSchema;
  declare number: number;
}
export class SetWashBoxActiveStateDto implements SetWashBoxActiveStateRequest {
  static readonly schema = setWashBoxActiveStateRequestSchema;
  declare isActive: boolean;
}
