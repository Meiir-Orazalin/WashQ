import {
  Body,
  ConflictException,
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
  ApiConflictResponse,
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
import { CreateWashBoxUseCase } from '../application/create-wash-box.use-case.js';
import { ListBranchWashBoxesUseCase } from '../application/list-branch-wash-boxes.use-case.js';
import { GetBranchWashBoxUseCase } from '../application/get-branch-wash-box.use-case.js';
import { SetWashBoxActiveStateUseCase } from '../application/set-wash-box-active-state.use-case.js';
import {
  WashBoxAlreadyExistsError,
  WashBoxNotFoundError,
} from '../application/wash-box.repository.js';
import { mapWashBoxResponse } from './wash-box-response.mapper.js';
import {
  CreateWashBoxDto,
  SetWashBoxActiveStateDto,
  WashBoxBranchParamsDto,
  WashBoxParamsDto,
  WashBoxQueryDto,
} from './wash-box.dto.js';
import {
  createWashBoxInputSchema,
  activeStateInputSchema,
  singleWashBoxSchema,
  washBoxListSchema,
} from './wash-box.openapi.js';

function translateFailure(error: unknown): never {
  if (error instanceof OrganizationNotFoundError)
    throw new NotFoundException({
      code: 'ORGANIZATION_NOT_FOUND',
      message: 'The organization was not found',
    });
  if (error instanceof BranchNotFoundError)
    throw new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'The branch was not found' });
  if (error instanceof WashBoxNotFoundError)
    throw new NotFoundException({
      code: 'WASH_BOX_NOT_FOUND',
      message: 'The wash box was not found',
    });
  if (error instanceof WashBoxAlreadyExistsError)
    throw new ConflictException({
      code: 'WASH_BOX_ALREADY_EXISTS',
      message: 'The wash box number is already used in this branch',
    });
  throw error;
}
@ApiTags('wash-boxes')
@ApiExtraModels(
  CreateWashBoxDto,
  SetWashBoxActiveStateDto,
  WashBoxBranchParamsDto,
  WashBoxParamsDto,
  WashBoxQueryDto,
)
@ApiBearerAuth('access-token')
@ApiParam({ name: 'organizationId', required: true, format: 'uuid' })
@ApiParam({ name: 'branchId', required: true, format: 'uuid' })
@ApiBadRequestResponse({
  description: '400 VALIDATION_ERROR. Invalid UUID, input or unknown body/query fields.',
})
@ApiUnauthorizedResponse({
  description: '401 AUTHENTICATION_REQUIRED. Authentication is required.',
})
@ApiNotFoundResponse({
  description:
    '404 ORGANIZATION_NOT_FOUND, BRANCH_NOT_FOUND or WASH_BOX_NOT_FOUND. Missing and foreign resources are indistinguishable at each level; parents resolved before box state.',
})
@ApiInternalServerErrorResponse({
  description: '500 INTERNAL_SERVER_ERROR. Sanitized unexpected failure.',
})
@UseGuards(CurrentCustomerGuard)
@Controller('organizations/:organizationId/branches/:branchId/wash-boxes')
export class WashBoxesController {
  constructor(
    @Inject(CreateWashBoxUseCase) private readonly createBox: CreateWashBoxUseCase,
    @Inject(ListBranchWashBoxesUseCase) private readonly listBoxes: ListBranchWashBoxesUseCase,
    @Inject(GetBranchWashBoxUseCase) private readonly getBox: GetBranchWashBoxUseCase,
    @Inject(SetWashBoxActiveStateUseCase) private readonly setState: SetWashBoxActiveStateUseCase,
  ) {}
  @Post()
  @ApiOperation({
    summary: 'Create an active wash box in an owned branch',
    description:
      'Only number is accepted. Unique within the branch, including inactive boxes. No opening-hours prerequisite. Activity is configuration, not occupancy.',
  })
  @ApiBody({ schema: createWashBoxInputSchema })
  @ApiCreatedResponse({ schema: singleWashBoxSchema })
  @ApiConflictResponse({
    description: '409 WASH_BOX_ALREADY_EXISTS. Number reserved in this branch.',
  })
  async create(
    @CurrentCustomerId() userId: string,
    @Param() params: WashBoxBranchParamsDto,
    @Body() input: CreateWashBoxDto,
    @Query() _query: WashBoxQueryDto,
  ) {
    try {
      return {
        washBox: mapWashBoxResponse(
          await this.createBox.execute(userId, params.organizationId, params.branchId, input),
        ),
      };
    } catch (error) {
      return translateFailure(error);
    }
  }
  @Get()
  @ApiOperation({
    summary: 'List all wash boxes in an owned branch',
    description:
      'Includes inactive boxes, ordered number ASC and id ASC. No pagination or filtering.',
  })
  @ApiOkResponse({ schema: washBoxListSchema })
  async list(
    @CurrentCustomerId() userId: string,
    @Param() params: WashBoxBranchParamsDto,
    @Query() _query: WashBoxQueryDto,
  ) {
    try {
      return {
        washBoxes: (
          await this.listBoxes.execute(userId, params.organizationId, params.branchId)
        ).map(mapWashBoxResponse),
      };
    } catch (error) {
      return translateFailure(error);
    }
  }
  @Get(':washBoxId')
  @ApiParam({ name: 'washBoxId', required: true, format: 'uuid' })
  @ApiOperation({ summary: 'View an owned branch wash box, including inactive boxes' })
  @ApiOkResponse({ schema: singleWashBoxSchema })
  async detail(
    @CurrentCustomerId() userId: string,
    @Param() params: WashBoxParamsDto,
    @Query() _query: WashBoxQueryDto,
  ) {
    try {
      return {
        washBox: mapWashBoxResponse(
          await this.getBox.execute(
            userId,
            params.organizationId,
            params.branchId,
            params.washBoxId,
          ),
        ),
      };
    } catch (error) {
      return translateFailure(error);
    }
  }
  @Patch(':washBoxId')
  @ApiParam({ name: 'washBoxId', required: true, format: 'uuid' })
  @ApiOperation({
    summary: 'Explicitly activate or deactivate an owned wash box',
    description:
      'Sets the requested boolean, never toggles. Repeated same-value requests succeed and preserve updatedAt; changes advance updatedAt. createdAt and number are immutable. Concurrent assignments are last-write-wins. Deactivation retains the row and reserved number.',
  })
  @ApiBody({ schema: activeStateInputSchema })
  @ApiOkResponse({ schema: singleWashBoxSchema })
  async update(
    @CurrentCustomerId() userId: string,
    @Param() params: WashBoxParamsDto,
    @Body() input: SetWashBoxActiveStateDto,
    @Query() _query: WashBoxQueryDto,
  ) {
    try {
      return {
        washBox: mapWashBoxResponse(
          await this.setState.execute(
            userId,
            params.organizationId,
            params.branchId,
            params.washBoxId,
            input,
          ),
        ),
      };
    } catch (error) {
      return translateFailure(error);
    }
  }
}
