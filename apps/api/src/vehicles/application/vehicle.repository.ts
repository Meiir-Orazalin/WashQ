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
  /** Atomically match both IDs; null deliberately conflates missing and foreign rows. */
  updateOwnedVehicle(
    ownerUserId: string,
    vehicleId: string,
    patch: VehiclePatch,
  ): Promise<Vehicle | null>;
  /** One owner-scoped mutation; false deliberately conflates missing and foreign rows. */
  deleteOwnedVehicle(ownerUserId: string, vehicleId: string): Promise<boolean>;
}

export type VehiclePatch = Partial<Omit<NewVehicle, 'ownerUserId'>>;

export class VehicleNotFoundError extends Error {
  constructor() {
    super('The vehicle was not found');
    this.name = 'VehicleNotFoundError';
  }
}

export class VehicleAlreadyExistsError extends Error {
  constructor() {
    super('A vehicle with this plate already exists');
    this.name = 'VehicleAlreadyExistsError';
  }
}
