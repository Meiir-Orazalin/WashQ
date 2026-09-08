import { describe, expect, it, vi } from 'vitest';
import { CreateVehicleUseCase } from '../src/vehicles/application/create-vehicle.use-case.js';
import { ListCurrentUserVehiclesUseCase } from '../src/vehicles/application/list-current-user-vehicles.use-case.js';
import {
  VehicleAlreadyExistsError,
  type VehicleRepository,
} from '../src/vehicles/application/vehicle.repository.js';
import { mapVehicleResponse } from '../src/vehicles/presentation/vehicle-response.mapper.js';

const owner = 'df4e7850-e329-4679-91f1-77b409d93f4f';
const vehicle = {
  id: owner,
  make: 'Toyota',
  model: 'Camry',
  plateNumber: '123ABC01',
  productionYear: null,
  color: null,
  createdAt: new Date('2026-09-07T10:00:00Z'),
  updatedAt: new Date('2026-09-07T10:00:00Z'),
};
const input = { make: ' Toyota ', model: ' Camry ', plateNumber: '123 abc 01' };
const repository = (): VehicleRepository => ({
  create: vi.fn().mockResolvedValue(vehicle),
  listByOwner: vi.fn().mockResolvedValue([]),
});

describe('vehicle application boundaries', () => {
  it('persists normalized values under only the supplied authenticated owner', async () => {
    const port = repository();
    await expect(new CreateVehicleUseCase(port).execute(owner, input)).resolves.toEqual(vehicle);
    expect(port.create).toHaveBeenCalledExactlyOnceWith({
      ownerUserId: owner,
      make: 'Toyota',
      model: 'Camry',
      plateNumber: '123ABC01',
      productionYear: null,
      color: null,
    });
  });
  it('rejects extra ownership values even outside HTTP', () => {
    const port = repository();
    expect(() =>
      new CreateVehicleUseCase(port).execute(owner, {
        ...input,
        ownerUserId: 'spoofed',
      } as typeof input),
    ).toThrow();
    expect(port.create).not.toHaveBeenCalled();
  });
  it('preserves the controlled duplicate error for presentation mapping', async () => {
    const port = repository();
    vi.mocked(port.create).mockRejectedValue(new VehicleAlreadyExistsError());
    await expect(new CreateVehicleUseCase(port).execute(owner, input)).rejects.toBeInstanceOf(
      VehicleAlreadyExistsError,
    );
  });
  it('propagates unexpected create/list failures to the sanitized HTTP boundary', async () => {
    const port = repository();
    const failure = new Error('internal persistence failure');
    vi.mocked(port.create).mockRejectedValue(failure);
    vi.mocked(port.listByOwner).mockRejectedValue(failure);
    await expect(new CreateVehicleUseCase(port).execute(owner, input)).rejects.toBe(failure);
    await expect(new ListCurrentUserVehiclesUseCase(port).execute(owner)).rejects.toBe(failure);
  });
  it('queries only the current owner, preserves repository ordering and permits empty results', async () => {
    const port = repository();
    const list = new ListCurrentUserVehiclesUseCase(port);
    await expect(list.execute(owner)).resolves.toEqual([]);
    const ordered = [vehicle, { ...vehicle, id: 'ef4e7850-e329-4679-91f1-77b409d93f4f' }];
    vi.mocked(port.listByOwner).mockResolvedValue(ordered);
    await expect(list.execute(owner)).resolves.toEqual(ordered);
    expect(port.listByOwner).toHaveBeenLastCalledWith(owner);
  });
  it('maps explicitly and never exposes ownership or credential internals', () => {
    const internal = { ...vehicle, ownerUserId: owner, passwordHash: 'not-public' };
    expect(Object.keys(mapVehicleResponse(internal)).sort()).toEqual([
      'color',
      'createdAt',
      'id',
      'make',
      'model',
      'plateNumber',
      'productionYear',
      'updatedAt',
    ]);
  });
});
