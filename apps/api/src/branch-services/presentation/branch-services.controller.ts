import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentCustomerGuard } from '../../auth/presentation/current-customer.guard.js';
import { CurrentCustomerId } from '../../auth/presentation/current-customer-id.decorator.js';
import { BranchNotFoundError, OrganizationNotFoundError } from '../../branches/public.js';
import { CreateBranchServiceUseCase } from '../application/create-branch-service.use-case.js';
import { ListBranchServicesUseCase } from '../application/list-branch-services.use-case.js';
import { GetBranchServiceUseCase } from '../application/get-branch-service.use-case.js';
import { UpdateBranchServiceUseCase } from '../application/update-branch-service.use-case.js';
import { ServiceNotFoundError } from '../application/branch-service.repository.js';
import { mapBranchServiceResponse } from './branch-service-response.mapper.js';
import {
  CreateBranchServiceDto,
  UpdateBranchServiceDto,
  BranchServiceBranchParamsDto,
  BranchServiceParamsDto,
  BranchServiceQueryDto,
} from './branch-service.dto.js';
import {
  createServiceInputSchema,
  updateServiceInputSchema,
  serviceResponseSchema,
  serviceListSchema,
} from './branch-service.openapi.js';
function translateFailure(error: unknown): never {
  if (error instanceof OrganizationNotFoundError)
    throw new NotFoundException({
      code: 'ORGANIZATION_NOT_FOUND',
      message: 'The organization was not found',
    });
  if (error instanceof BranchNotFoundError)
    throw new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'The branch was not found' });
  if (error instanceof ServiceNotFoundError)
    throw new NotFoundException({
      code: 'SERVICE_NOT_FOUND',
      message: 'The service was not found',
    });
  throw error;
}
@ApiTags('branch-services')
@ApiExtraModels(
  CreateBranchServiceDto,
  UpdateBranchServiceDto,
  BranchServiceBranchParamsDto,
  BranchServiceParamsDto,
  BranchServiceQueryDto,
)
@ApiBearerAuth('access-token')
@ApiParam({ name: 'organizationId', required: true, format: 'uuid' })
@ApiParam({ name: 'branchId', required: true, format: 'uuid' })
@ApiBadRequestResponse({
  description: '400 VALIDATION_ERROR. Invalid UUID/input or unknown body/query fields.',
})
@ApiUnauthorizedResponse({
  description: '401 AUTHENTICATION_REQUIRED. Authentication is required.',
})
@ApiNotFoundResponse({
  description:
    '404 ORGANIZATION_NOT_FOUND, BRANCH_NOT_FOUND or SERVICE_NOT_FOUND. Foreign and missing match at each level; parents authorized before service state.',
})
@ApiInternalServerErrorResponse({
  description: '500 INTERNAL_SERVER_ERROR. Sanitized unexpected failure.',
})
@UseGuards(CurrentCustomerGuard)
@Controller('organizations/:organizationId/branches/:branchId/services')
export class BranchServicesController {
  constructor(
    @Inject(CreateBranchServiceUseCase) private readonly createService: CreateBranchServiceUseCase,
    @Inject(ListBranchServicesUseCase) private readonly listServices: ListBranchServicesUseCase,
    @Inject(GetBranchServiceUseCase) private readonly getService: GetBranchServiceUseCase,
    @Inject(UpdateBranchServiceUseCase) private readonly updateService: UpdateBranchServiceUseCase,
  ) {}
  @Post()
  @ApiOperation({
    summary: 'Create a fixed-price KZT service in an owned branch',
    description:
      'Initially active; no hours or boxes prerequisite. Names are not unique. Activity is catalogue configuration, not bookable availability.',
  })
  @ApiBody({ schema: createServiceInputSchema })
  @ApiCreatedResponse({ schema: serviceResponseSchema })
  async create(
    @CurrentCustomerId() userId: string,
    @Param() params: BranchServiceBranchParamsDto,
    @Body() input: CreateBranchServiceDto,
    @Query() _query: BranchServiceQueryDto,
  ) {
    try {
      return {
        service: mapBranchServiceResponse(
          await this.createService.execute(userId, params.organizationId, params.branchId, input),
        ),
      };
    } catch (error) {
      return translateFailure(error);
    }
  }
  @Get()
  @ApiOperation({
    summary: 'List all owned branch services',
    description: 'Active and inactive, createdAt DESC/id DESC; no filtering or pagination.',
  })
  @ApiOkResponse({ schema: serviceListSchema })
  async list(
    @CurrentCustomerId() userId: string,
    @Param() params: BranchServiceBranchParamsDto,
    @Query() _query: BranchServiceQueryDto,
  ) {
    try {
      return {
        services: (
          await this.listServices.execute(userId, params.organizationId, params.branchId)
        ).map(mapBranchServiceResponse),
      };
    } catch (error) {
      return translateFailure(error);
    }
  }
  @Get(':serviceId')
  @ApiParam({ name: 'serviceId', required: true, format: 'uuid' })
  @ApiOperation({ summary: 'View an owned branch service, including inactive' })
  @ApiOkResponse({ schema: serviceResponseSchema })
  async detail(
    @CurrentCustomerId() userId: string,
    @Param() params: BranchServiceParamsDto,
    @Query() _query: BranchServiceQueryDto,
  ) {
    try {
      return {
        service: mapBranchServiceResponse(
          await this.getService.execute(
            userId,
            params.organizationId,
            params.branchId,
            params.serviceId,
          ),
        ),
      };
    } catch (error) {
      return translateFailure(error);
    }
  }
  @Patch(':serviceId')
  @ApiParam({ name: 'serviceId', required: true, format: 'uuid' })
  @ApiOperation({
    summary: 'Partially update an owned branch service',
    description:
      'Only supplied mutable fields change atomically. Currency and parents are immutable. Null/blank description clears. Repeated same values succeed and preserve updatedAt; changes advance it. Last-write-wins, no automatic retries.',
  })
  @ApiBody({ schema: updateServiceInputSchema })
  @ApiOkResponse({ schema: serviceResponseSchema })
  async update(
    @CurrentCustomerId() userId: string,
    @Param() params: BranchServiceParamsDto,
    @Body() patch: UpdateBranchServiceDto,
    @Query() _query: BranchServiceQueryDto,
  ) {
    try {
      return {
        service: mapBranchServiceResponse(
          await this.updateService.execute(
            userId,
            params.organizationId,
            params.branchId,
            params.serviceId,
            patch,
          ),
        ),
      };
    } catch (error) {
      return translateFailure(error);
    }
  }
}
