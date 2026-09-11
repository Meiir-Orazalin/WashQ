import type { OrganizationRepository } from './organization.repository.js';

export class ListOwnedOrganizationsUseCase {
  constructor(private readonly repository: OrganizationRepository) {}
  execute(userId: string) {
    return this.repository.listOwnedByUser(userId);
  }
}
