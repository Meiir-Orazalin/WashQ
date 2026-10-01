/** Public application boundary; no repositories, schedules or persistence models. */
export { BranchNotFoundError } from './application/branch.repository.js';
export { OrganizationNotFoundError } from '../organizations/public.js';
export const BRANCH_OWNER_ACCESS = Symbol('BRANCH_OWNER_ACCESS');
export interface BranchOwnerAccess {
  assertCurrentOwner(
    userId: string,
    organizationId: string,
    branchId: string,
  ): Promise<Readonly<{ branchId: string }>>;
}
