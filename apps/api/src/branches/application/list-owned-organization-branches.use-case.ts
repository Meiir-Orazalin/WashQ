import { organizationIdParamsSchema } from '@washqueue/contracts';
import type { OrganizationOwnerAccess } from '../../organizations/public.js';
import type { BranchRepository } from './branch.repository.js';

export class ListOwnedOrganizationBranchesUseCase {
  constructor(
    private readonly access: OrganizationOwnerAccess,
    private readonly repository: BranchRepository,
  ) {}
  async execute(userId: string, organizationId: string) {
    organizationIdParamsSchema.parse({ organizationId });
    await this.access.assertCurrentOwner(userId, organizationId);
    return this.repository.listBranchesByOrganization(organizationId);
  }
}
