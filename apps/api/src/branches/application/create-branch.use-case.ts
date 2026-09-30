import {
  createBranchRequestSchema,
  organizationIdParamsSchema,
  type CreateBranchRequest,
} from '@washqueue/contracts';
import type { OrganizationOwnerAccess } from '../../organizations/public.js';
import type { BranchRepository } from './branch.repository.js';

export class CreateBranchUseCase {
  constructor(
    private readonly access: OrganizationOwnerAccess,
    private readonly repository: BranchRepository,
  ) {}
  async execute(userId: string, organizationId: string, input: CreateBranchRequest) {
    organizationIdParamsSchema.parse({ organizationId });
    const values = createBranchRequestSchema.parse(input);
    await this.access.assertCurrentOwner(userId, organizationId);
    return this.repository.createBranch(organizationId, values);
  }
}
