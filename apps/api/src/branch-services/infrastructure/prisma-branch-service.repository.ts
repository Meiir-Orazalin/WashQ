import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { CreateBranchServiceRequest, UpdateBranchServiceRequest } from '@washqueue/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { BranchNotFoundError } from '../../branches/public.js';
import type { BranchServiceRepository } from '../application/branch-service.repository.js';
import type { BranchService } from '../domain/branch-service.js';
const publicSelect = {
  id: true,
  name: true,
  description: true,
  durationMinutes: true,
  priceMinor: true,
  currency: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;
const missingParentMetadata = z.object({
  driverAdapterError: z.object({
    cause: z.object({
      kind: z.literal('ForeignKeyConstraintViolation'),
      constraint: z.object({ index: z.literal('branch_services_branch_id_fkey') }),
    }),
  }),
});
const publicService = (
  row: Omit<BranchService, 'currency'> & { currency: string },
): BranchService => ({ ...row, currency: z.literal('KZT').parse(row.currency) });
@Injectable()
export class PrismaBranchServiceRepository implements BranchServiceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async create(branchId: string, input: CreateBranchServiceRequest): Promise<BranchService> {
    try {
      const row = await this.prisma.branchService.create({
        data: {
          branchId,
          name: input.name,
          description: input.description,
          durationMinutes: input.durationMinutes,
          priceMinor: input.priceMinor,
          currency: input.currency,
        },
        select: publicSelect,
      });
      return publicService(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003' &&
        missingParentMetadata.safeParse(error.meta).success
      )
        throw new BranchNotFoundError();
      throw error;
    }
  }
  async listByBranch(branchId: string): Promise<BranchService[]> {
    return (
      await this.prisma.branchService.findMany({
        where: { branchId },
        select: publicSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
    ).map(publicService);
  }
  async findByBranchAndId(branchId: string, serviceId: string): Promise<BranchService | null> {
    const row = await this.prisma.branchService.findFirst({
      where: { branchId, id: serviceId },
      select: publicSelect,
    });
    return row ? publicService(row) : null;
  }
  async updateByBranchAndId(
    branchId: string,
    serviceId: string,
    patch: UpdateBranchServiceRequest,
  ): Promise<BranchService | null> {
    // Allowlisted supplied columns only. PostgreSQL evaluates changes against the locked current row.
    const writes: Prisma.Sql[] = [];
    const changed: Prisma.Sql[] = [];
    if (patch.name !== undefined) {
      writes.push(Prisma.sql`name = ${patch.name}`);
      changed.push(Prisma.sql`name IS DISTINCT FROM ${patch.name}`);
    }
    if (patch.description !== undefined) {
      writes.push(Prisma.sql`description = ${patch.description}`);
      changed.push(Prisma.sql`description IS DISTINCT FROM ${patch.description}`);
    }
    if (patch.durationMinutes !== undefined) {
      writes.push(Prisma.sql`duration_minutes = ${patch.durationMinutes}`);
      changed.push(Prisma.sql`duration_minutes IS DISTINCT FROM ${patch.durationMinutes}`);
    }
    if (patch.priceMinor !== undefined) {
      writes.push(Prisma.sql`price_minor = ${patch.priceMinor}`);
      changed.push(Prisma.sql`price_minor IS DISTINCT FROM ${patch.priceMinor}`);
    }
    if (patch.isActive !== undefined) {
      writes.push(Prisma.sql`is_active = ${patch.isActive}`);
      changed.push(Prisma.sql`is_active IS DISTINCT FROM ${patch.isActive}`);
    }
    if (!writes.length) throw new Error('A service update requires a mutable field');
    const rows = await this.prisma.$queryRaw<BranchService[]>(Prisma.sql`
      UPDATE branch_services SET ${Prisma.join(writes)},
      updated_at = CASE WHEN ${Prisma.join(changed, ' OR ')}
        THEN GREATEST(clock_timestamp(), updated_at + INTERVAL '1 millisecond') ELSE updated_at END
      WHERE branch_id = ${branchId}::uuid AND id = ${serviceId}::uuid
      RETURNING id, name, description, duration_minutes AS "durationMinutes", price_minor AS "priceMinor",
        currency, is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"
    `);
    return rows[0] ? publicService(rows[0]) : null;
  }
}
