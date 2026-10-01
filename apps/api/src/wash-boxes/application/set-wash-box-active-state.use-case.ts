import {
  washBoxIdParamsSchema,
  setWashBoxActiveStateRequestSchema,
  type SetWashBoxActiveStateRequest,
} from '@washqueue/contracts';
import type { BranchOwnerAccess } from '../../branches/public.js';
import { WashBoxNotFoundError, type WashBoxRepository } from './wash-box.repository.js';

export class SetWashBoxActiveStateUseCase {
  constructor(
    private readonly access: BranchOwnerAccess,
    private readonly repository: WashBoxRepository,
  ) {}
  async execute(
    userId: string,
    organizationId: string,
    branchId: string,
    washBoxId: string,
    input: SetWashBoxActiveStateRequest,
  ) {
    washBoxIdParamsSchema.parse({ organizationId, branchId, washBoxId });
    const parsed = setWashBoxActiveStateRequestSchema.parse(input);
    const scope = await this.access.assertCurrentOwner(userId, organizationId, branchId);
    const box = await this.repository.setActiveState(scope.branchId, washBoxId, parsed.isActive);
    if (!box) throw new WashBoxNotFoundError();
    return box;
  }
}
