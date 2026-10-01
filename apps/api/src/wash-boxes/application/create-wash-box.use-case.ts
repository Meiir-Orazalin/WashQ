import {
  branchIdParamsSchema,
  createWashBoxRequestSchema,
  type CreateWashBoxRequest,
} from '@washqueue/contracts';
import type { BranchOwnerAccess } from '../../branches/public.js';
import type { WashBoxRepository } from './wash-box.repository.js';

export class CreateWashBoxUseCase {
  constructor(
    private readonly access: BranchOwnerAccess,
    private readonly repository: WashBoxRepository,
  ) {}
  async execute(
    userId: string,
    organizationId: string,
    branchId: string,
    input: CreateWashBoxRequest,
  ) {
    branchIdParamsSchema.parse({ organizationId, branchId });
    const parsed = createWashBoxRequestSchema.parse(input);
    const scope = await this.access.assertCurrentOwner(userId, organizationId, branchId);
    return this.repository.create(scope.branchId, parsed.number);
  }
}
