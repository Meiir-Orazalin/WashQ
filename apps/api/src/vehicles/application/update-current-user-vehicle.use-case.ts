import {
  updateVehicleRequestSchema,
  vehicleIdParamsSchema,
  type UpdateVehicleRequest,
} from '@washqueue/contracts';
import { VehicleNotFoundError, type VehicleRepository } from './vehicle.repository.js';
import type { Vehicle } from '../domain/vehicle.js';

export class UpdateCurrentUserVehicleUseCase {
  constructor(private readonly repository: VehicleRepository) {}

  async execute(
    ownerUserId: string,
    vehicleId: string,
    input: UpdateVehicleRequest,
  ): Promise<Vehicle> {
    vehicleIdParamsSchema.parse({ vehicleId });
    const values = updateVehicleRequestSchema.parse(input);
    // Undefined is omission, never a persistence value; null deliberately clears optionals.
    const patch = {
      ...(values.make !== undefined ? { make: values.make } : {}),
      ...(values.model !== undefined ? { model: values.model } : {}),
      ...(values.plateNumber !== undefined ? { plateNumber: values.plateNumber } : {}),
      ...(values.productionYear !== undefined ? { productionYear: values.productionYear } : {}),
      ...(values.color !== undefined ? { color: values.color } : {}),
    };
    const vehicle = await this.repository.updateOwnedVehicle(ownerUserId, vehicleId, patch);
    if (!vehicle) throw new VehicleNotFoundError();
    return vehicle;
  }
}
