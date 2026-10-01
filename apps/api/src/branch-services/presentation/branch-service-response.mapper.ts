import { publicBranchServiceSchema } from '@washqueue/contracts';
import type { BranchService } from '../domain/branch-service.js';
export function mapBranchServiceResponse(service: BranchService) {
  return publicBranchServiceSchema.parse({
    id: service.id,
    name: service.name,
    description: service.description,
    durationMinutes: service.durationMinutes,
    priceMinor: service.priceMinor,
    currency: service.currency,
    isActive: service.isActive,
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  });
}
