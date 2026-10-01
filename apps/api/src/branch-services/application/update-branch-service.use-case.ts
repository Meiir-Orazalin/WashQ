import {
  branchServiceIdParamsSchema,
  updateBranchServiceRequestSchema,
  type UpdateBranchServiceRequest,
} from '@washqueue/contracts';
import type { BranchOwnerAccess } from '../../branches/public.js';
import { ServiceNotFoundError, type BranchServiceRepository } from './branch-service.repository.js';
export class UpdateBranchServiceUseCase {
  constructor(
    private readonly access: BranchOwnerAccess,
    private readonly repository: BranchServiceRepository,
  ) {}
  async execute(
    userId: string,
    organizationId: string,
    branchId: string,
    serviceId: string,
    input: UpdateBranchServiceRequest,
  ) {
    branchServiceIdParamsSchema.parse({ organizationId, branchId, serviceId });
    const patch = updateBranchServiceRequestSchema.parse(input);
    const scope = await this.access.assertCurrentOwner(userId, organizationId, branchId);
    const service = await this.repository.updateByBranchAndId(scope.branchId, serviceId, patch);
    if (!service) throw new ServiceNotFoundError();
    return service;
  }
}
