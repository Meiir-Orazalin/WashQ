import { publicVehicleSchema, type PublicVehicle } from '@washqueue/contracts';
import type { Vehicle } from '../domain/vehicle.js';

export function mapVehicleResponse(vehicle: Vehicle): PublicVehicle {
  return publicVehicleSchema.parse({
    id: vehicle.id,
    make: vehicle.make,
    model: vehicle.model,
    plateNumber: vehicle.plateNumber,
    productionYear: vehicle.productionYear,
    color: vehicle.color,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
  });
}
