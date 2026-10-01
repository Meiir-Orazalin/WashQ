import { branchServiceIdParamsSchema } from '@washqueue/contracts';
import type { BranchOwnerAccess } from '../../branches/public.js';
import { ServiceNotFoundError, type BranchServiceRepository } from './branch-service.repository.js';
export class GetBranchServiceUseCase {
  constructor(
    private readonly access: BranchOwnerAccess,
    private readonly repository: BranchServiceRepository,
  ) {}
  async execute(userId: string, organizationId: string, branchId: string, serviceId: string) {
    branchServiceIdParamsSchema.parse({ organizationId, branchId, serviceId });
    const scope = await this.access.assertCurrentOwner(userId, organizationId, branchId);
    const service = await this.repository.findByBranchAndId(scope.branchId, serviceId);
    if (!service) throw new ServiceNotFoundError();
    return service;
  }
}
