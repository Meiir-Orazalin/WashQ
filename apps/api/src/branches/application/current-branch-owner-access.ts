import type { BranchOwnerAccess } from '../public.js';
import type { GetOwnedBranchUseCase } from './get-owned-branch.use-case.js';

export class CurrentBranchOwnerAccess implements BranchOwnerAccess {
  constructor(private readonly getOwnedBranch: GetOwnedBranchUseCase) {}
  async assertCurrentOwner(userId: string, organizationId: string, branchId: string) {
    const branch = await this.getOwnedBranch.execute(userId, organizationId, branchId);
    return Object.freeze({ branchId: branch.id });
  }
}
