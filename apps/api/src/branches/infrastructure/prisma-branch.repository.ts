import { Inject, Injectable } from '@nestjs/common';
import type { CreateBranchRequest } from '@washqueue/contracts';
import { PrismaService } from '../../database/prisma.service.js';
import type { BranchRepository } from '../application/branch.repository.js';
import type { WeeklyOpeningHours } from '../domain/branch.js';

const publicBranchSelect = {
  id: true,
  name: true,
  city: true,
  addressLine: true,
  timeZone: true,
  createdAt: true,
  updatedAt: true,
} as const;
const hoursSelect = {
  dayOfWeek: true,
  status: true,
  opensAtMinute: true,
  closesAtMinute: true,
  closesNextDay: true,
} as const;
@Injectable()
export class PrismaBranchRepository implements BranchRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  createBranch(organizationId: string, input: CreateBranchRequest) {
    return this.prisma.branch.create({
      data: {
        organizationId,
        name: input.name,
        city: input.city,
        addressLine: input.addressLine,
        timeZone: input.timeZone,
      },
      select: publicBranchSelect,
    });
  }
  listBranchesByOrganization(organizationId: string) {
    return this.prisma.branch.findMany({
      where: { organizationId },
      select: publicBranchSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
  findBranchByOrganizationAndId(organizationId: string, branchId: string) {
    return this.prisma.branch.findFirst({
      where: { organizationId, id: branchId },
      select: {
        ...publicBranchSelect,
        openingHours: { select: hoursSelect, orderBy: { dayOfWeek: 'asc' } },
      },
    });
  }
  replaceOpeningHours(organizationId: string, branchId: string, schedule: WeeklyOpeningHours[]) {
    if (schedule.length !== 7 || new Set(schedule.map((entry) => entry.dayOfWeek)).size !== 7)
      throw new Error('A complete weekly schedule is required');
    return this.prisma.$transaction(async (transaction) => {
      // Parameterized scoped row lock. Every writer takes it before touching child rows.
      const rows = await transaction.$queryRaw<
        { id: string }[]
      >`SELECT id FROM branches WHERE id = ${branchId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
      if (rows.length === 0) return null;
      await transaction.branchOpeningHours.deleteMany({
        where: { branchId, branch: { organizationId } },
      });
      await transaction.branchOpeningHours.createMany({
        data: schedule.map((entry) => ({ branchId, ...entry })),
      });
      await transaction.branch.updateMany({
        where: { id: branchId, organizationId },
        data: { updatedAt: new Date() },
      });
      return transaction.branchOpeningHours.findMany({
        where: { branchId, branch: { organizationId } },
        select: hoursSelect,
        orderBy: { dayOfWeek: 'asc' },
      });
    });
  }
}
