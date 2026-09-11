import type { Organization } from '../domain/organization.js';

export const ORGANIZATION_REPOSITORY = Symbol('ORGANIZATION_REPOSITORY');
export interface NewOrganization {
  name: string;
  description: string | null;
}
export interface OrganizationRepository {
  /** Atomic organization and initial OWNER membership creation. */
  createWithOwnerMembership(userId: string, input: NewOrganization): Promise<Organization>;
  /** OWNER membership filtered, createdAt DESC, id DESC. */
  listOwnedByUser(userId: string): Promise<Organization[]>;
  /** Both organization and OWNER membership matched in persistence. */
  findOwnedById(userId: string, organizationId: string): Promise<Organization | null>;
}
export class OrganizationNotFoundError extends Error {
  constructor() {
    super('The organization was not found');
    this.name = 'OrganizationNotFoundError';
  }
}
