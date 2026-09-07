import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GetCurrentUserUseCase } from '../src/auth/application/get-current-user.use-case.js';
import type { AccessTokenService } from '../src/auth/application/access-token.service.js';
import { CurrentCustomerGuard } from '../src/auth/presentation/current-customer.guard.js';
import { HttpExceptionFilter } from '../src/http/http-exception.filter.js';
import { ZodValidationPipe } from '../src/http/zod-validation.pipe.js';
import { requestIdMiddleware } from '../src/http/request-id.middleware.js';
import type { UserRepository } from '../src/users/application/user-repository.js';
import { CreateVehicleUseCase } from '../src/vehicles/application/create-vehicle.use-case.js';
import { ListCurrentUserVehiclesUseCase } from '../src/vehicles/application/list-current-user-vehicles.use-case.js';
import type { VehicleRepository } from '../src/vehicles/application/vehicle.repository.js';
import { VehiclesController } from '../src/vehicles/presentation/vehicles.controller.js';

@Controller('public-test')
class PublicTestController {
  @Get() get() {
    return { public: true };
  }
}

export async function createVehicleTestApp(
  repository: VehicleRepository,
  users: UserRepository,
  tokens: AccessTokenService,
) {
  const module = await Test.createTestingModule({
    controllers: [VehiclesController, PublicTestController],
    providers: [
      CurrentCustomerGuard,
      { provide: GetCurrentUserUseCase, useValue: new GetCurrentUserUseCase(tokens, users) },
      { provide: CreateVehicleUseCase, useValue: new CreateVehicleUseCase(repository) },
      {
        provide: ListCurrentUserVehiclesUseCase,
        useValue: new ListCurrentUserVehiclesUseCase(repository),
      },
    ],
  }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(requestIdMiddleware);
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}
