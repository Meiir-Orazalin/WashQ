import { updateVehicleRequestSchema, type PublicVehicle } from '@washqueue/contracts';

export const vehicleEditFields = [
  { name: 'make', label: 'Make' },
  { name: 'model', label: 'Model' },
  { name: 'plateNumber', label: 'Plate number' },
  { name: 'productionYear', label: 'Production year (optional)' },
  { name: 'color', label: 'Color (optional)' },
] as const;

export type VehicleEditField = (typeof vehicleEditFields)[number]['name'];
export type VehicleEditValues = Record<VehicleEditField, string>;

export function vehicleEditValues(vehicle: PublicVehicle): VehicleEditValues {
  return {
    make: vehicle.make,
    model: vehicle.model,
    plateNumber: vehicle.plateNumber,
    productionYear: vehicle.productionYear?.toString() ?? '',
    color: vehicle.color ?? '',
  };
}

/** Translate changed form controls only; shared contracts own normalization. */
export function validateVehicleEdit(initial: VehicleEditValues, values: VehicleEditValues) {
  const patch: Partial<Record<VehicleEditField, unknown>> = {};
  for (const { name } of vehicleEditFields) {
    if (values[name] === initial[name]) continue;
    if (name === 'productionYear') {
      const year = values[name].trim();
      patch[name] = year === '' ? null : /^\d+$/.test(year) ? Number(year) : year;
    } else {
      patch[name] = values[name];
    }
  }
  return updateVehicleRequestSchema.safeParse(patch);
}
