import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
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
  type ApiResponseSchemaHost,
} from '@nestjs/swagger';
import type {
  CreateOrganizationResponse,
  OrganizationListResponse,
  OrganizationDetailResponse,
} from '@washqueue/contracts';
import { CurrentCustomerGuard } from '../../auth/presentation/current-customer.guard.js';
import { CurrentCustomerId } from '../../auth/presentation/current-customer-id.decorator.js';
import { CreateOrganizationUseCase } from '../application/create-organization.use-case.js';
import { ListOwnedOrganizationsUseCase } from '../application/list-owned-organizations.use-case.js';
import { GetOwnedOrganizationUseCase } from '../application/get-owned-organization.use-case.js';
import { OrganizationNotFoundError } from '../application/organization.repository.js';
import {
  CreateOrganizationRequestDto,
  OrganizationIdParamsDto,
  OrganizationQueryDto,
} from './organization.dto.js';
import { mapOrganizationResponse } from './organization-response.mapper.js';

type ResponseSchema = ApiResponseSchemaHost['schema'];

const organizationSchema: ResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'description', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 2, maxLength: 120 },
    description: { type: 'string', nullable: true, maxLength: 500 },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};
const detailSchema: ResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['organization'],
  properties: { organization: organizationSchema },
};

@ApiTags('organizations')
@ApiExtraModels(CreateOrganizationRequestDto, OrganizationIdParamsDto, OrganizationQueryDto)
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({
  description: '401 AUTHENTICATION_REQUIRED. Authentication is required.',
})
@ApiBadRequestResponse({
  description: '400 VALIDATION_ERROR. Invalid input, UUID or unknown fields/query parameters.',
})
@ApiInternalServerErrorResponse({
  description: '500 INTERNAL_SERVER_ERROR. An unexpected sanitized failure occurred.',
})
@UseGuards(CurrentCustomerGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(
    @Inject(CreateOrganizationUseCase)
    private readonly createOrganization: CreateOrganizationUseCase,
    @Inject(ListOwnedOrganizationsUseCase)
    private readonly listOrganizations: ListOwnedOrganizationsUseCase,
    @Inject(GetOwnedOrganizationUseCase)
    private readonly getOrganization: GetOwnedOrganizationUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create an organization with its initial owner',
    description:
      'Atomically creates an organization and OWNER membership derived only from verified identity. Names need not be unique. No cookie mutation.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          minLength: 2,
          maxLength: 120,
          description:
            'NFKC, trimmed and whitespace collapsed; casing preserved; control characters rejected.',
        },
        description: {
          type: 'string',
          nullable: true,
          maxLength: 500,
          description:
            'Trimmed plain text; omitted/null/blank becomes null. Internal line breaks retained; other controls rejected.',
        },
      },
    },
  })
  @ApiCreatedResponse({ schema: detailSchema })
  async create(
    @CurrentCustomerId() userId: string,
    @Body() input: CreateOrganizationRequestDto,
    @Query() _query: OrganizationQueryDto,
  ): Promise<CreateOrganizationResponse> {
    return {
      organization: mapOrganizationResponse(await this.createOrganization.execute(userId, input)),
    };
  }

  @Get()
  @ApiOperation({
    summary: 'List organizations owned by the current user',
    description:
      'Server-side OWNER membership filter. Ordered by createdAt descending, then id descending. No pagination.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['organizations'],
      properties: { organizations: { type: 'array', items: organizationSchema } },
    },
  })
  async list(
    @CurrentCustomerId() userId: string,
    @Query() _query: OrganizationQueryDto,
  ): Promise<OrganizationListResponse> {
    return {
      organizations: (await this.listOrganizations.execute(userId)).map(mapOrganizationResponse),
    };
  }

  @Get(':organizationId')
  @ApiOperation({
    summary: 'View an owned organization',
    description:
      'Organization ID and verified OWNER membership are matched together. Missing and not-owned organizations are indistinguishable.',
  })
  @ApiParam({ name: 'organizationId', required: true, format: 'uuid' })
  @ApiOkResponse({ schema: detailSchema })
  @ApiNotFoundResponse({
    description: '404 ORGANIZATION_NOT_FOUND. The organization was not found.',
  })
  async detail(
    @CurrentCustomerId() userId: string,
    @Param() params: OrganizationIdParamsDto,
    @Query() _query: OrganizationQueryDto,
  ): Promise<OrganizationDetailResponse> {
    try {
      return {
        organization: mapOrganizationResponse(
          await this.getOrganization.execute(userId, params.organizationId),
        ),
      };
    } catch (error) {
      if (error instanceof OrganizationNotFoundError)
        throw new NotFoundException({
          code: 'ORGANIZATION_NOT_FOUND',
          message: 'The organization was not found',
        });
      throw error;
    }
  }
}
