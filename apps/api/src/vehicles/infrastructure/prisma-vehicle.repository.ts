import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  VehicleAlreadyExistsError,
  type NewVehicle,
  type VehiclePatch,
  type VehicleRepository,
} from '../application/vehicle.repository.js';
import type { Vehicle } from '../domain/vehicle.js';

const publicVehicleSelect = {
  id: true,
  make: true,
  model: true,
  plateNumber: true,
  productionYear: true,
  color: true,
  createdAt: true,
  updatedAt: true,
} as const;

const plateConflictMetadata = z.object({
  driverAdapterError: z.object({
    cause: z.object({
      kind: z.literal('UniqueConstraintViolation'),
      constraint: z.object({
        fields: z.tuple([z.literal('owner_user_id'), z.literal('plate_number')]),
      }),
    }),
  }),
});

@Injectable()
export class PrismaVehicleRepository implements VehicleRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(vehicle: NewVehicle): Promise<Vehicle> {
    try {
      return await this.prisma.vehicle.create({ data: vehicle, select: publicVehicleSelect });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        plateConflictMetadata.safeParse(error.meta).success
      ) {
        throw new VehicleAlreadyExistsError();
      }
      throw error;
    }
  }

  listByOwner(ownerUserId: string): Promise<Vehicle[]> {
    return this.prisma.vehicle.findMany({
      where: { ownerUserId },
      select: publicVehicleSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async updateOwnedVehicle(
    ownerUserId: string,
    vehicleId: string,
    patch: VehiclePatch,
  ): Promise<Vehicle | null> {
    try {
      const vehicles = await this.prisma.vehicle.updateManyAndReturn({
        where: { id: vehicleId, ownerUserId },
        data: patch,
        select: publicVehicleSelect,
      });
      return vehicles[0] ?? null;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        plateConflictMetadata.safeParse(error.meta).success
      ) {
        throw new VehicleAlreadyExistsError();
      }
      throw error;
    }
  }

  async deleteOwnedVehicle(ownerUserId: string, vehicleId: string): Promise<boolean> {
    const result = await this.prisma.vehicle.deleteMany({ where: { id: vehicleId, ownerUserId } });
    return result.count === 1;
  }
}
