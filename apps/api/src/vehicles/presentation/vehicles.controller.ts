import { Body, ConflictException, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CreateVehicleResponse, VehicleListResponse } from '@washqueue/contracts';
import { CurrentCustomerGuard } from '../../auth/presentation/current-customer.guard.js';
import { CurrentCustomerId } from '../../auth/presentation/current-customer-id.decorator.js';
import { CreateVehicleUseCase } from '../application/create-vehicle.use-case.js';
import { ListCurrentUserVehiclesUseCase } from '../application/list-current-user-vehicles.use-case.js';
import { VehicleAlreadyExistsError } from '../application/vehicle.repository.js';
import {
  CreateVehicleRequestDto,
  CreateVehicleResponseDto,
  VehicleListResponseDto,
} from './vehicle.dto.js';
import { mapVehicleResponse } from './vehicle-response.mapper.js';

@ApiTags('vehicles')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({
  description: '401 AUTHENTICATION_REQUIRED. Authentication is required.',
})
@ApiInternalServerErrorResponse({
  description: '500 INTERNAL_SERVER_ERROR. An unexpected sanitized failure occurred.',
})
@UseGuards(CurrentCustomerGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(
    @Inject(CreateVehicleUseCase) private readonly createVehicle: CreateVehicleUseCase,
    @Inject(ListCurrentUserVehiclesUseCase)
    private readonly listVehicles: ListCurrentUserVehiclesUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a vehicle for the current customer',
    description:
      'Owner comes exclusively from verified Bearer identity. Unknown request fields, including ownership fields, are rejected.',
  })
  @ApiBody({ type: CreateVehicleRequestDto })
  @ApiCreatedResponse({ type: CreateVehicleResponseDto })
  @ApiBadRequestResponse({
    description: '400 VALIDATION_ERROR. Invalid vehicle data or unknown fields.',
  })
  @ApiConflictResponse({
    description: '409 VEHICLE_ALREADY_EXISTS. This customer already saved the canonical plate.',
  })
  async create(
    @CurrentCustomerId() userId: string,
    @Body() input: CreateVehicleRequestDto,
  ): Promise<CreateVehicleResponse> {
    try {
      return { vehicle: mapVehicleResponse(await this.createVehicle.execute(userId, input)) };
    } catch (error) {
      if (error instanceof VehicleAlreadyExistsError) {
        throw new ConflictException({
          code: 'VEHICLE_ALREADY_EXISTS',
          message: 'A vehicle with this plate already exists',
        });
      }
      throw error;
    }
  }

  @Get()
  @ApiOperation({
    summary: 'List the current customer’s vehicles',
    description:
      'Only the verified customer’s vehicles, ordered by createdAt descending, then id descending. No pagination.',
  })
  @ApiOkResponse({ type: VehicleListResponseDto })
  async list(@CurrentCustomerId() userId: string): Promise<VehicleListResponse> {
    return { vehicles: (await this.listVehicles.execute(userId)).map(mapVehicleResponse) };
  }
}
