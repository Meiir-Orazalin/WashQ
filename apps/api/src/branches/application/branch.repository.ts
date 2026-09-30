import type { CreateBranchRequest } from '@washqueue/contracts';
import type { Branch, BranchDetail, WeeklyOpeningHours } from '../domain/branch.js';

export const BRANCH_REPOSITORY = Symbol('BRANCH_REPOSITORY');
export interface BranchRepository {
  createBranch(organizationId: string, input: CreateBranchRequest): Promise<Branch>;
  listBranchesByOrganization(organizationId: string): Promise<Branch[]>;
  findBranchByOrganizationAndId(
    organizationId: string,
    branchId: string,
  ): Promise<BranchDetail | null>;
  /** Branch row lock serializes complete replacement transactions. Null means no scoped branch. */
  replaceOpeningHours(
    organizationId: string,
    branchId: string,
    schedule: WeeklyOpeningHours[],
  ): Promise<WeeklyOpeningHours[] | null>;
}
export class BranchNotFoundError extends Error {
  constructor() {
    super('The branch was not found');
    this.name = 'BranchNotFoundError';
  }
}
