import { describe, expect, it, vi } from 'vitest';
import { CreateVehicleUseCase } from '../src/vehicles/application/create-vehicle.use-case.js';
import { ListCurrentUserVehiclesUseCase } from '../src/vehicles/application/list-current-user-vehicles.use-case.js';
import { UpdateCurrentUserVehicleUseCase } from '../src/vehicles/application/update-current-user-vehicle.use-case.js';
import { DeleteCurrentUserVehicleUseCase } from '../src/vehicles/application/delete-current-user-vehicle.use-case.js';
import {
  VehicleAlreadyExistsError,
  VehicleNotFoundError,
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
  updateOwnedVehicle: vi.fn().mockResolvedValue(vehicle),
  deleteOwnedVehicle: vi.fn().mockResolvedValue(true),
  create: vi.fn().mockResolvedValue(vehicle),
  listByOwner: vi.fn().mockResolvedValue([]),
});

describe('vehicle application boundaries', () => {
  it('updates by authenticated owner and vehicle, with normalized patch values only', async () => {
    const port = repository();
    const result = await new UpdateCurrentUserVehicleUseCase(port).execute(owner, vehicle.id, {
      make: ' Land  Rover ',
      plateNumber: '１２３－ａｂｃ－０１',
      productionYear: null,
      color: ' ',
    });
    expect(port.updateOwnedVehicle).toHaveBeenCalledExactlyOnceWith(owner, vehicle.id, {
      make: 'Land Rover',
      plateNumber: '123ABC01',
      productionYear: null,
      color: null,
    });
    expect(result).toEqual(vehicle);
    expect(mapVehicleResponse(result)).not.toHaveProperty('ownerUserId');
    expect(port.create).not.toHaveBeenCalled();
    expect(port.listByOwner).not.toHaveBeenCalled();
  });
  it('leaves omitted fields out of the persistence patch, including explicit undefined', async () => {
    const port = repository();
    await new UpdateCurrentUserVehicleUseCase(port).execute(owner, vehicle.id, {
      model: 'Hybrid',
      color: undefined,
    });
    expect(port.updateOwnedVehicle).toHaveBeenCalledExactlyOnceWith(owner, vehicle.id, {
      model: 'Hybrid',
    });
  });
  it.each(['missing', 'foreign'])(
    'maps %s update/delete results to identical application errors',
    async () => {
      const port = repository();
      vi.mocked(port.updateOwnedVehicle).mockResolvedValue(null);
      vi.mocked(port.deleteOwnedVehicle).mockResolvedValue(false);
      await expect(
        new UpdateCurrentUserVehicleUseCase(port).execute(owner, vehicle.id, { color: null }),
      ).rejects.toBeInstanceOf(VehicleNotFoundError);
      await expect(
        new DeleteCurrentUserVehicleUseCase(port).execute(owner, vehicle.id),
      ).rejects.toEqual(new VehicleNotFoundError());
    },
  );
  it('preserves duplicate update failures for controlled 409 mapping', async () => {
    const port = repository();
    vi.mocked(port.updateOwnedVehicle).mockRejectedValue(new VehicleAlreadyExistsError());
    await expect(
      new UpdateCurrentUserVehicleUseCase(port).execute(owner, vehicle.id, {
        plateNumber: '123-ABC-01',
      }),
    ).rejects.toBeInstanceOf(VehicleAlreadyExistsError);
  });
  it('deletes only through the owner-scoped port and returns no data', async () => {
    const port = repository();
    await expect(
      new DeleteCurrentUserVehicleUseCase(port).execute(owner, vehicle.id),
    ).resolves.toBeUndefined();
    expect(port.deleteOwnedVehicle).toHaveBeenCalledExactlyOnceWith(owner, vehicle.id);
    for (const method of [port.create, port.listByOwner, port.updateOwnedVehicle])
      expect(method).not.toHaveBeenCalled();
  });
  it('propagates update/delete infrastructure errors to the sanitized HTTP boundary', async () => {
    const port = repository();
    const failure = new Error('private persistence detail');
    vi.mocked(port.updateOwnedVehicle).mockRejectedValue(failure);
    vi.mocked(port.deleteOwnedVehicle).mockRejectedValue(failure);
    await expect(
      new UpdateCurrentUserVehicleUseCase(port).execute(owner, vehicle.id, { color: null }),
    ).rejects.toBe(failure);
    await expect(new DeleteCurrentUserVehicleUseCase(port).execute(owner, vehicle.id)).rejects.toBe(
      failure,
    );
  });
  it('rejects invalid paths and ownership spoofing before persistence even outside HTTP', async () => {
    const port = repository();
    const update = new UpdateCurrentUserVehicleUseCase(port);
    await expect(update.execute(owner, 'invalid', { model: 'X' })).rejects.toThrow();
    await expect(
      new DeleteCurrentUserVehicleUseCase(port).execute(owner, 'invalid'),
    ).rejects.toThrow();
    await expect(
      update.execute(owner, vehicle.id, { model: 'X', ownerUserId: 'spoofed' } as {
        model: string;
      }),
    ).rejects.toThrow();
    expect(port.updateOwnedVehicle).not.toHaveBeenCalled();
    expect(port.deleteOwnedVehicle).not.toHaveBeenCalled();
  });
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
