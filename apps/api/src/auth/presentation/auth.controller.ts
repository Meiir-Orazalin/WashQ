import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { RegistrationResponse } from '@washqueue/contracts';
import { RegisterCustomerUseCase } from '../application/register-customer.use-case.js';
import { DuplicateUserEmailError } from '../../users/application/user-repository.js';
import { RegisterRequestDto } from './register-request.dto.js';
import { mapRegistrationResponse } from './registration-response.mapper.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(RegisterCustomerUseCase)
    private readonly registerCustomer: RegisterCustomerUseCase,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a customer account' })
  @ApiBody({ type: RegisterRequestDto })
  @ApiCreatedResponse({ description: 'The customer account was created.' })
  @ApiBadRequestResponse({ description: 'The registration input is invalid.' })
  @ApiConflictResponse({ description: 'The normalized email is already registered.' })
  async register(@Body() request: RegisterRequestDto): Promise<RegistrationResponse> {
    try {
      const user = await this.registerCustomer.execute(request);
      return mapRegistrationResponse(user);
    } catch (error) {
      if (error instanceof DuplicateUserEmailError) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account with this email already exists',
        });
      }

      throw error;
    }
  }
}
