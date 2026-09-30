import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
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
import { branchDetailResponseSchema, openingHoursResponseSchema } from '@washqueue/contracts';
import { CurrentCustomerGuard } from '../../auth/presentation/current-customer.guard.js';
import { CurrentCustomerId } from '../../auth/presentation/current-customer-id.decorator.js';
import { OrganizationNotFoundError } from '../../organizations/public.js';
import { BranchNotFoundError } from '../application/branch.repository.js';
import { CreateBranchUseCase } from '../application/create-branch.use-case.js';
import { ListOwnedOrganizationBranchesUseCase } from '../application/list-owned-organization-branches.use-case.js';
import { GetOwnedBranchUseCase } from '../application/get-owned-branch.use-case.js';
import { ReplaceBranchOpeningHoursUseCase } from '../application/replace-branch-opening-hours.use-case.js';
import {
  BranchOrganizationParamsDto,
  BranchParamsDto,
  BranchQueryDto,
  CreateBranchDto,
  ReplaceOpeningHoursDto,
} from './branch.dto.js';
import { mapBranchResponse, mapOpeningHoursResponse } from './branch-response.mapper.js';
import {
  branchInputSchema,
  branchSchema,
  branchResponseSchema,
  branchDetailSchema,
  scheduleSchema,
} from './branch.openapi.js';

function translateFailure(error: unknown): never {
  if (error instanceof OrganizationNotFoundError)
    throw new NotFoundException({
      code: 'ORGANIZATION_NOT_FOUND',
      message: 'The organization was not found',
    });
  if (error instanceof BranchNotFoundError)
    throw new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'The branch was not found' });
  throw error;
}
@ApiTags('branches')
@ApiExtraModels(
  BranchOrganizationParamsDto,
  BranchParamsDto,
  BranchQueryDto,
  CreateBranchDto,
  ReplaceOpeningHoursDto,
)
@ApiBearerAuth('access-token')
@ApiParam({ name: 'organizationId', required: true, format: 'uuid' })
@ApiBadRequestResponse({
  description:
    '400 VALIDATION_ERROR. Invalid UUID, input, time zone, schedule or unknown fields/query.',
})
@ApiUnauthorizedResponse({
  description: '401 AUTHENTICATION_REQUIRED. Authentication is required.',
})
@ApiNotFoundResponse({
  description:
    '404 ORGANIZATION_NOT_FOUND for missing/non-owned organization. Detail/PUT: BRANCH_NOT_FOUND for a missing branch or branch under another organization.',
})
@ApiInternalServerErrorResponse({
  description: '500 INTERNAL_SERVER_ERROR. Sanitized unexpected failure.',
})
@UseGuards(CurrentCustomerGuard)
@Controller('organizations/:organizationId/branches')
export class BranchesController {
  constructor(
    @Inject(CreateBranchUseCase) private readonly createBranch: CreateBranchUseCase,
    @Inject(ListOwnedOrganizationBranchesUseCase)
    private readonly listBranches: ListOwnedOrganizationBranchesUseCase,
    @Inject(GetOwnedBranchUseCase) private readonly getBranch: GetOwnedBranchUseCase,
    @Inject(ReplaceBranchOpeningHoursUseCase)
    private readonly replaceHours: ReplaceBranchOpeningHoursUseCase,
  ) {}
  @Post()
  @ApiOperation({
    summary: 'Create an organization-owned branch',
    description:
      'OWNER access through the organizations public boundary. NFKC/trim/whitespace normalization, no controls. Creates no opening-hour rows.',
  })
  @ApiBody({ schema: branchInputSchema })
  @ApiCreatedResponse({ schema: branchResponseSchema })
  async create(
    @CurrentCustomerId() userId: string,
    @Param() params: BranchOrganizationParamsDto,
    @Body() input: CreateBranchDto,
    @Query() _query: BranchQueryDto,
  ) {
    try {
      return {
        branch: mapBranchResponse(
          await this.createBranch.execute(userId, params.organizationId, input),
        ),
      };
    } catch (error) {
      return translateFailure(error);
    }
  }
  @Get()
  @ApiOperation({
    summary: 'List branches of an owned organization',
    description: 'CreatedAt DESC, id DESC. No pagination. No public ownership fields.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['branches'],
      properties: { branches: { type: 'array', items: branchSchema } },
    },
  })
  async list(
    @CurrentCustomerId() userId: string,
    @Param() params: BranchOrganizationParamsDto,
    @Query() _query: BranchQueryDto,
  ) {
    try {
      return {
        branches: (await this.listBranches.execute(userId, params.organizationId)).map(
          mapBranchResponse,
        ),
      };
    } catch (error) {
      return translateFailure(error);
    }
  }
  @Get(':branchId')
  @ApiParam({ name: 'branchId', required: true, format: 'uuid' })
  @ApiOperation({ summary: 'View an owned branch and its local weekly schedule' })
  @ApiOkResponse({ schema: branchDetailSchema })
  async detail(
    @CurrentCustomerId() userId: string,
    @Param() params: BranchParamsDto,
    @Query() _query: BranchQueryDto,
  ) {
    try {
      const branch = await this.getBranch.execute(userId, params.organizationId, params.branchId);
      return branchDetailResponseSchema.parse({
        branch: {
          ...mapBranchResponse(branch),
          openingHours: mapOpeningHoursResponse(branch.openingHours),
        },
      });
    } catch (error) {
      return translateFailure(error);
    }
  }
  @Put(':branchId/opening-hours')
  @ApiParam({ name: 'branchId', required: true, format: 'uuid' })
  @ApiOperation({
    summary: 'Atomically replace the complete local weekly schedule',
    description:
      'Seven unique weekdays. OPEN lasts 1–1439 local minutes with explicit overnight flag; CLOSED/OPEN_24_HOURS require null times and false next-day. Branch row lock serializes writers; last committed full writer wins. Failure preserves prior schedule. No UTC conversion or open-now calculation.',
  })
  @ApiBody({ schema: scheduleSchema })
  @ApiOkResponse({ schema: scheduleSchema })
  async replace(
    @CurrentCustomerId() userId: string,
    @Param() params: BranchParamsDto,
    @Body() input: ReplaceOpeningHoursDto,
    @Query() _query: BranchQueryDto,
  ) {
    try {
      return openingHoursResponseSchema.parse({
        openingHours: mapOpeningHoursResponse(
          await this.replaceHours.execute(userId, params.organizationId, params.branchId, input),
        ),
      });
    } catch (error) {
      return translateFailure(error);
    }
  }
}
