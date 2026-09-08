import type { Vehicle } from '../domain/vehicle.js';

export const VEHICLE_REPOSITORY = Symbol('VEHICLE_REPOSITORY');

export interface NewVehicle {
  ownerUserId: string;
  make: string;
  model: string;
  plateNumber: string;
  productionYear: number | null;
  color: string | null;
}

export interface VehicleRepository {
  create(vehicle: NewVehicle): Promise<Vehicle>;
  /** Only this owner's vehicles, createdAt DESC, id DESC. */
  listByOwner(ownerUserId: string): Promise<Vehicle[]>;
}

export class VehicleAlreadyExistsError extends Error {
  constructor() {
    super('A vehicle with this plate already exists');
    this.name = 'VehicleAlreadyExistsError';
  }
}
