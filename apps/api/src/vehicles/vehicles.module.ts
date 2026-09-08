import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { CreateVehicleUseCase } from './application/create-vehicle.use-case.js';
import { UpdateCurrentUserVehicleUseCase } from './application/update-current-user-vehicle.use-case.js';
import { DeleteCurrentUserVehicleUseCase } from './application/delete-current-user-vehicle.use-case.js';
import { ListCurrentUserVehiclesUseCase } from './application/list-current-user-vehicles.use-case.js';
import { VEHICLE_REPOSITORY, type VehicleRepository } from './application/vehicle.repository.js';
import { PrismaVehicleRepository } from './infrastructure/prisma-vehicle.repository.js';
import { VehiclesController } from './presentation/vehicles.controller.js';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [VehiclesController],
  providers: [
    PrismaVehicleRepository,
    { provide: VEHICLE_REPOSITORY, useExisting: PrismaVehicleRepository },
    {
      provide: UpdateCurrentUserVehicleUseCase,
      inject: [VEHICLE_REPOSITORY],
      useFactory: (repository: VehicleRepository) =>
        new UpdateCurrentUserVehicleUseCase(repository),
    },
    {
      provide: DeleteCurrentUserVehicleUseCase,
      inject: [VEHICLE_REPOSITORY],
      useFactory: (repository: VehicleRepository) =>
        new DeleteCurrentUserVehicleUseCase(repository),
    },
    {
      provide: CreateVehicleUseCase,
      inject: [VEHICLE_REPOSITORY],
      useFactory: (repository: VehicleRepository) => new CreateVehicleUseCase(repository),
    },
    {
      provide: ListCurrentUserVehiclesUseCase,
      inject: [VEHICLE_REPOSITORY],
      useFactory: (repository: VehicleRepository) => new ListCurrentUserVehiclesUseCase(repository),
    },
  ],
})
export class VehiclesModule {}
