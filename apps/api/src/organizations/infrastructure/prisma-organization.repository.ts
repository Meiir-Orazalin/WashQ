import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  NewOrganization,
  OrganizationRepository,
} from '../application/organization.repository.js';

const publicOrganizationSelect = {
  id: true,
  name: true,
  description: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  createWithOwnerMembership(userId: string, input: NewOrganization) {
    return this.prisma.$transaction(async (transaction) => {
      const organization = await transaction.organization.create({
        data: { name: input.name, description: input.description },
        select: publicOrganizationSelect,
      });
      await transaction.organizationMembership.create({
        data: { organizationId: organization.id, userId, role: 'OWNER' },
        select: { id: true },
      });
      return organization;
    });
  }

  listOwnedByUser(userId: string) {
    return this.prisma.organization.findMany({
      where: { memberships: { some: { userId, role: 'OWNER' } } },
      select: publicOrganizationSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  findOwnedById(userId: string, organizationId: string) {
    return this.prisma.organization.findFirst({
      where: { id: organizationId, memberships: { some: { userId, role: 'OWNER' } } },
      select: publicOrganizationSelect,
    });
  }
}
