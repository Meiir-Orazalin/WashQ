import { vehicleIdParamsSchema } from '@washqueue/contracts';
import { VehicleNotFoundError, type VehicleRepository } from './vehicle.repository.js';

export class DeleteCurrentUserVehicleUseCase {
  constructor(private readonly repository: VehicleRepository) {}

  async execute(ownerUserId: string, vehicleId: string): Promise<void> {
    vehicleIdParamsSchema.parse({ vehicleId });
    if (!(await this.repository.deleteOwnedVehicle(ownerUserId, vehicleId))) {
      throw new VehicleNotFoundError();
    }
  }
}
