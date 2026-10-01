import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { BranchNotFoundError } from '../../branches/public.js';
import {
  WashBoxAlreadyExistsError,
  type WashBoxRepository,
} from '../application/wash-box.repository.js';
import type { WashBox } from '../domain/wash-box.js';

const publicSelect = {
  id: true,
  number: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;
const duplicateMetadata = z.object({
  driverAdapterError: z.object({
    cause: z.object({
      kind: z.literal('UniqueConstraintViolation'),
      constraint: z.object({ fields: z.tuple([z.literal('branch_id'), z.literal('number')]) }),
    }),
  }),
});
const parentMetadata = z.object({
  driverAdapterError: z.object({
    cause: z.object({
      kind: z.literal('ForeignKeyConstraintViolation'),
      constraint: z.object({ index: z.literal('wash_boxes_branch_id_fkey') }),
    }),
  }),
});

@Injectable()
export class PrismaWashBoxRepository implements WashBoxRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async create(branchId: string, number: number): Promise<WashBox> {
    try {
      return await this.prisma.washBox.create({ data: { branchId, number }, select: publicSelect });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002' && duplicateMetadata.safeParse(error.meta).success)
          throw new WashBoxAlreadyExistsError();
        if (error.code === 'P2003' && parentMetadata.safeParse(error.meta).success)
          throw new BranchNotFoundError();
      }
      throw error;
    }
  }
  listByBranch(branchId: string): Promise<WashBox[]> {
    return this.prisma.washBox.findMany({
      where: { branchId },
      select: publicSelect,
      orderBy: [{ number: 'asc' }, { id: 'asc' }],
    });
  }
  findByBranchAndId(branchId: string, washBoxId: string): Promise<WashBox | null> {
    return this.prisma.washBox.findFirst({
      where: { branchId, id: washBoxId },
      select: publicSelect,
    });
  }
  async setActiveState(
    branchId: string,
    washBoxId: string,
    isActive: boolean,
  ): Promise<WashBox | null> {
    // One parameterized, scoped atomic write. Same-value assignments preserve updatedAt.
    const rows = await this.prisma.$queryRaw<WashBox[]>`
      UPDATE wash_boxes SET
        updated_at = CASE WHEN is_active IS DISTINCT FROM ${isActive}
          THEN GREATEST(clock_timestamp(), updated_at + INTERVAL '1 millisecond') ELSE updated_at END,
        is_active = ${isActive}
      WHERE branch_id = ${branchId}::uuid AND id = ${washBoxId}::uuid
      RETURNING id, number, is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"
    `;
    return rows[0] ?? null;
  }
}
