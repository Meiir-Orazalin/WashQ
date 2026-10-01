import { washBoxIdParamsSchema } from '@washqueue/contracts';
import type { BranchOwnerAccess } from '../../branches/public.js';
import { WashBoxNotFoundError, type WashBoxRepository } from './wash-box.repository.js';

export class GetBranchWashBoxUseCase {
  constructor(
    private readonly access: BranchOwnerAccess,
    private readonly repository: WashBoxRepository,
  ) {}
  async execute(userId: string, organizationId: string, branchId: string, washBoxId: string) {
    washBoxIdParamsSchema.parse({ organizationId, branchId, washBoxId });
    const scope = await this.access.assertCurrentOwner(userId, organizationId, branchId);
    const box = await this.repository.findByBranchAndId(scope.branchId, washBoxId);
    if (!box) throw new WashBoxNotFoundError();
    return box;
  }
}
