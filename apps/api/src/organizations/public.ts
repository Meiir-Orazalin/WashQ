/** Public application boundary. No framework or persistence types cross it. */
export { OrganizationNotFoundError } from './application/organization.repository.js';
export const ORGANIZATION_OWNER_ACCESS = Symbol('ORGANIZATION_OWNER_ACCESS');
export interface OrganizationOwnerAccess {
  assertCurrentOwner(userId: string, organizationId: string): Promise<void>;
}
