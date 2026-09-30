import { organizationIdParamsSchema } from '@washqueue/contracts';
import type { OrganizationOwnerAccess } from '../public.js';
import {
  OrganizationNotFoundError,
  type OrganizationRepository,
} from './organization.repository.js';

export class CurrentOrganizationOwnerAccess implements OrganizationOwnerAccess {
  constructor(private readonly repository: OrganizationRepository) {}
  async assertCurrentOwner(userId: string, organizationId: string): Promise<void> {
    organizationIdParamsSchema.parse({ organizationId });
    if (!(await this.repository.findOwnedById(userId, organizationId)))
      throw new OrganizationNotFoundError();
  }
}
