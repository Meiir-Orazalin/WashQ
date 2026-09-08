import {
  Body,
  Controller,
  Inject,
  Patch,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CurrentUserResponse } from '@washqueue/contracts';
import { CurrentCustomerGuard } from '../../auth/presentation/current-customer.guard.js';
import { CurrentCustomerId } from '../../auth/presentation/current-customer-id.decorator.js';
import { CurrentUserResponseDto } from '../../auth/presentation/current-user-response.dto.js';
import { mapCurrentUserResponse } from '../../auth/presentation/current-user-response.mapper.js';
import {
  CurrentUserUnavailableError,
  UpdateCurrentUserProfileUseCase,
} from '../application/update-current-user-profile.use-case.js';
import { ProfileQueryDto, UpdateProfileRequestDto } from './update-profile-request.dto.js';

@ApiTags('users')
@ApiExtraModels(UpdateProfileRequestDto, ProfileQueryDto)
@ApiBearerAuth('access-token')
@UseGuards(CurrentCustomerGuard)
@Controller('users')
export class UsersController {
  constructor(
    @Inject(UpdateCurrentUserProfileUseCase)
    private readonly updateProfile: UpdateCurrentUserProfileUseCase,
  ) {}

  @Patch('me')
  @ApiOperation({
    summary: 'Update the current customer’s profile names',
    description:
      'Identity comes only from verified Bearer authentication. At least one name is required. Unknown fields and query parameters are rejected. Omitted names retain their values. No cookie or session is changed.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      minProperties: 1,
      properties: {
        firstName: {
          type: 'string',
          minLength: 2,
          maxLength: 60,
          description: 'Registration normalization: trim only, preserve casing; omitted retains.',
        },
        lastName: {
          type: 'string',
          nullable: true,
          minLength: 2,
          maxLength: 60,
          description:
            'Registration normalization: trim only; null or blank clears, omitted retains.',
        },
      },
    },
  })
  @ApiOkResponse({ type: CurrentUserResponseDto })
  @ApiBadRequestResponse({ description: '400 VALIDATION_ERROR. Empty, invalid or unknown input.' })
  @ApiUnauthorizedResponse({
    description: '401 AUTHENTICATION_REQUIRED. Authentication is required.',
  })
  @ApiInternalServerErrorResponse({
    description: '500 INTERNAL_SERVER_ERROR. An unexpected sanitized failure occurred.',
  })
  async update(
    @CurrentCustomerId() userId: string,
    @Body() input: UpdateProfileRequestDto,
    @Query() _query: ProfileQueryDto,
  ): Promise<CurrentUserResponse> {
    try {
      return mapCurrentUserResponse(await this.updateProfile.execute(userId, input));
    } catch (error) {
      if (error instanceof CurrentUserUnavailableError) {
        throw new UnauthorizedException({
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required',
        });
      }
      throw error;
    }
  }
}
