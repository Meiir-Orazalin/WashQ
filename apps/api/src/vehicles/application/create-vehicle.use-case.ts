import { createVehicleRequestSchema, type CreateVehicleInput } from '@washqueue/contracts';
import type { Vehicle } from '../domain/vehicle.js';
import type { VehicleRepository } from './vehicle.repository.js';

export class CreateVehicleUseCase {
  constructor(private readonly repository: VehicleRepository) {}

  execute(ownerUserId: string, input: CreateVehicleInput): Promise<Vehicle> {
    const values = createVehicleRequestSchema.parse(input);
    return this.repository.create({ ...values, ownerUserId });
  }
}
