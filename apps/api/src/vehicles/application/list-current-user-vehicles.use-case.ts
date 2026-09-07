import type { Vehicle } from '../domain/vehicle.js';
import type { VehicleRepository } from './vehicle.repository.js';

export class ListCurrentUserVehiclesUseCase {
  constructor(private readonly repository: VehicleRepository) {}

  execute(ownerUserId: string): Promise<Vehicle[]> {
    return this.repository.listByOwner(ownerUserId);
  }
}
