import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiParam,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';
import type {
  CreateVehicleResponse,
  UpdateVehicleResponse,
  VehicleListResponse,
} from '@washqueue/contracts';
import { CurrentCustomerGuard } from '../../auth/presentation/current-customer.guard.js';
import { CurrentCustomerId } from '../../auth/presentation/current-customer-id.decorator.js';
import { CreateVehicleUseCase } from '../application/create-vehicle.use-case.js';
import { ListCurrentUserVehiclesUseCase } from '../application/list-current-user-vehicles.use-case.js';
import {
  VehicleAlreadyExistsError,
  VehicleNotFoundError,
} from '../application/vehicle.repository.js';
import { UpdateCurrentUserVehicleUseCase } from '../application/update-current-user-vehicle.use-case.js';
import { DeleteCurrentUserVehicleUseCase } from '../application/delete-current-user-vehicle.use-case.js';
import {
  CreateVehicleRequestDto,
  CreateVehicleResponseDto,
  VehicleListResponseDto,
  VehicleIdParamsDto,
  UpdateVehicleRequestDto,
  UpdateVehicleResponseDto,
} from './vehicle.dto.js';
import { mapVehicleResponse } from './vehicle-response.mapper.js';

@ApiTags('vehicles')
@ApiExtraModels(UpdateVehicleRequestDto, VehicleIdParamsDto)
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
    @Inject(UpdateCurrentUserVehicleUseCase)
    private readonly updateVehicle: UpdateCurrentUserVehicleUseCase,
    @Inject(DeleteCurrentUserVehicleUseCase)
    private readonly deleteVehicle: DeleteCurrentUserVehicleUseCase,
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

  @Patch(':vehicleId')
  @ApiOperation({
    summary: 'Update an owned vehicle',
    description:
      'Partial update with at least one mutable field. Unknown and ownership fields are rejected. Omitted fields retain their values. Missing and not-owned vehicles are indistinguishable.',
  })
  @ApiParam({ name: 'vehicleId', required: true, format: 'uuid' })
  @ApiBody({
    schema: { allOf: [{ $ref: getSchemaPath(UpdateVehicleRequestDto) }], minProperties: 1 },
  })
  @ApiOkResponse({ type: UpdateVehicleResponseDto })
  @ApiBadRequestResponse({
    description: '400 VALIDATION_ERROR. Invalid UUID, empty patch, invalid data or unknown fields.',
  })
  @ApiNotFoundResponse({ description: '404 VEHICLE_NOT_FOUND. The vehicle was not found.' })
  @ApiConflictResponse({
    description: '409 VEHICLE_ALREADY_EXISTS. This customer already saved the canonical plate.',
  })
  async update(
    @CurrentCustomerId() userId: string,
    @Param() params: VehicleIdParamsDto,
    @Body() input: UpdateVehicleRequestDto,
  ): Promise<UpdateVehicleResponse> {
    try {
      return {
        vehicle: mapVehicleResponse(
          await this.updateVehicle.execute(userId, params.vehicleId, input),
        ),
      };
    } catch (error) {
      if (error instanceof VehicleNotFoundError) {
        throw new NotFoundException({
          code: 'VEHICLE_NOT_FOUND',
          message: 'The vehicle was not found',
        });
      }
      if (error instanceof VehicleAlreadyExistsError) {
        throw new ConflictException({
          code: 'VEHICLE_ALREADY_EXISTS',
          message: 'A vehicle with this plate already exists',
        });
      }
      throw error;
    }
  }

  @Delete(':vehicleId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete an owned vehicle',
    description:
      'Deletes only the vehicle belonging to the verified customer. Missing and not-owned vehicles return the same generic 404, including repeated deletion.',
  })
  @ApiParam({ name: 'vehicleId', required: true, format: 'uuid' })
  @ApiNoContentResponse({ description: 'Vehicle deleted. No response body.' })
  @ApiBadRequestResponse({ description: '400 VALIDATION_ERROR. Invalid vehicle UUID.' })
  @ApiNotFoundResponse({ description: '404 VEHICLE_NOT_FOUND. The vehicle was not found.' })
  async delete(
    @CurrentCustomerId() userId: string,
    @Param() params: VehicleIdParamsDto,
  ): Promise<void> {
    try {
      await this.deleteVehicle.execute(userId, params.vehicleId);
    } catch (error) {
      if (error instanceof VehicleNotFoundError) {
        throw new NotFoundException({
          code: 'VEHICLE_NOT_FOUND',
          message: 'The vehicle was not found',
        });
      }
      throw error;
    }
  }
}
