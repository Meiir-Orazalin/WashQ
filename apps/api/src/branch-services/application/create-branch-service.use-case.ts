import {
  branchIdParamsSchema,
  createBranchServiceRequestSchema,
  type CreateBranchServiceInput,
} from '@washqueue/contracts';
import type { BranchOwnerAccess } from '../../branches/public.js';
import type { BranchServiceRepository } from './branch-service.repository.js';
export class CreateBranchServiceUseCase {
  constructor(
    private readonly access: BranchOwnerAccess,
    private readonly repository: BranchServiceRepository,
  ) {}
  async execute(
    userId: string,
    organizationId: string,
    branchId: string,
    input: CreateBranchServiceInput,
  ) {
    branchIdParamsSchema.parse({ organizationId, branchId });
    const parsed = createBranchServiceRequestSchema.parse(input);
    const scope = await this.access.assertCurrentOwner(userId, organizationId, branchId);
    return this.repository.create(scope.branchId, parsed);
  }
}
