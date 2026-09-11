import {
  createOrganizationRequestSchema,
  type CreateOrganizationInput,
} from '@washqueue/contracts';
import type { OrganizationRepository } from './organization.repository.js';

export class CreateOrganizationUseCase {
  constructor(private readonly repository: OrganizationRepository) {}
  execute(userId: string, input: CreateOrganizationInput) {
    const values = createOrganizationRequestSchema.parse(input);
    return this.repository.createWithOwnerMembership(userId, values);
  }
}
