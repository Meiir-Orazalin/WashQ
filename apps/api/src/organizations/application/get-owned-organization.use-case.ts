import { organizationIdParamsSchema } from '@washqueue/contracts';
import {
  OrganizationNotFoundError,
  type OrganizationRepository,
} from './organization.repository.js';

export class GetOwnedOrganizationUseCase {
  constructor(private readonly repository: OrganizationRepository) {}
  async execute(userId: string, organizationId: string) {
    organizationIdParamsSchema.parse({ organizationId });
    const organization = await this.repository.findOwnedById(userId, organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    return organization;
  }
}
