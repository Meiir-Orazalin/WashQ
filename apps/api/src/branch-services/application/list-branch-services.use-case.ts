import { branchIdParamsSchema } from '@washqueue/contracts';
import type { BranchOwnerAccess } from '../../branches/public.js';
import type { BranchServiceRepository } from './branch-service.repository.js';
export class ListBranchServicesUseCase {
  constructor(
    private readonly access: BranchOwnerAccess,
    private readonly repository: BranchServiceRepository,
  ) {}
  async execute(userId: string, organizationId: string, branchId: string) {
    branchIdParamsSchema.parse({ organizationId, branchId });
    const scope = await this.access.assertCurrentOwner(userId, organizationId, branchId);
    return this.repository.listByBranch(scope.branchId);
  }
}
