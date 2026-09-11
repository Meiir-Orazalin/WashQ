import { publicOrganizationSchema } from '@washqueue/contracts';
import type { Organization } from '../domain/organization.js';

export function mapOrganizationResponse(organization: Organization) {
  return publicOrganizationSchema.parse({
    id: organization.id,
    name: organization.name,
    description: organization.description,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  });
}
