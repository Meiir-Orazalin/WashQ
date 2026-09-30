import { branchIdParamsSchema } from '@washqueue/contracts';
import type { OrganizationOwnerAccess } from '../../organizations/public.js';
import { BranchNotFoundError, type BranchRepository } from './branch.repository.js';

export class GetOwnedBranchUseCase {
  constructor(
    private readonly access: OrganizationOwnerAccess,
    private readonly repository: BranchRepository,
  ) {}
  async execute(userId: string, organizationId: string, branchId: string) {
    branchIdParamsSchema.parse({ organizationId, branchId });
    await this.access.assertCurrentOwner(userId, organizationId);
    const branch = await this.repository.findBranchByOrganizationAndId(organizationId, branchId);
    if (!branch) throw new BranchNotFoundError();
    return branch;
  }
}
