import type { CreateBranchServiceRequest, UpdateBranchServiceRequest } from '@washqueue/contracts';
import type { BranchService } from '../domain/branch-service.js';
export const BRANCH_SERVICE_REPOSITORY = Symbol('BRANCH_SERVICE_REPOSITORY');
export interface BranchServiceRepository {
  create(branchId: string, input: CreateBranchServiceRequest): Promise<BranchService>;
  listByBranch(branchId: string): Promise<BranchService[]>;
  findByBranchAndId(branchId: string, serviceId: string): Promise<BranchService | null>;
  updateByBranchAndId(
    branchId: string,
    serviceId: string,
    patch: UpdateBranchServiceRequest,
  ): Promise<BranchService | null>;
}
export class ServiceNotFoundError extends Error {
  constructor() {
    super('The service was not found');
    this.name = 'ServiceNotFoundError';
  }
}
