import {
  branchIdParamsSchema,
  replaceOpeningHoursRequestSchema,
  type ReplaceOpeningHoursRequest,
} from '@washqueue/contracts';
import type { OrganizationOwnerAccess } from '../../organizations/public.js';
import { BranchNotFoundError, type BranchRepository } from './branch.repository.js';

export class ReplaceBranchOpeningHoursUseCase {
  constructor(
    private readonly access: OrganizationOwnerAccess,
    private readonly repository: BranchRepository,
  ) {}
  async execute(
    userId: string,
    organizationId: string,
    branchId: string,
    input: ReplaceOpeningHoursRequest,
  ) {
    branchIdParamsSchema.parse({ organizationId, branchId });
    const { openingHours } = replaceOpeningHoursRequestSchema.parse(input);
    await this.access.assertCurrentOwner(userId, organizationId);
    const minute = (value: string | null) =>
      value === null ? null : Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const result = await this.repository.replaceOpeningHours(
      organizationId,
      branchId,
      openingHours.map((entry) => ({
        dayOfWeek: entry.dayOfWeek,
        status: entry.status,
        opensAtMinute: minute(entry.opensAt),
        closesAtMinute: minute(entry.closesAt),
        closesNextDay: entry.closesNextDay,
      })),
    );
    if (!result) throw new BranchNotFoundError();
    return result;
  }
}
