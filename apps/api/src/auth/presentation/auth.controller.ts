import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { LoginResponse, RegistrationResponse } from '@washqueue/contracts';
import type { Response } from 'express';
import {
  InvalidCredentialsError,
  LoginCustomerUseCase,
} from '../application/login-customer.use-case.js';
import { RegisterCustomerUseCase } from '../application/register-customer.use-case.js';
import { DuplicateUserEmailError } from '../../users/application/user-repository.js';
import { LoginRequestDto } from './login-request.dto.js';
import { LoginResponseDto } from './login-response.dto.js';
import { mapLoginResponse } from './login-response.mapper.js';
import { RegisterRequestDto } from './register-request.dto.js';
import { RefreshTokenCookiePolicy, refreshTokenCookieName } from './refresh-token-cookie.policy.js';
import { mapRegistrationResponse } from './registration-response.mapper.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(RegisterCustomerUseCase)
    private readonly registerCustomer: RegisterCustomerUseCase,
    @Inject(LoginCustomerUseCase)
    private readonly loginCustomer: LoginCustomerUseCase,
    @Inject(RefreshTokenCookiePolicy)
    private readonly refreshTokenCookiePolicy: RefreshTokenCookiePolicy,
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

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Log in a customer',
    description: 'Returns an access token and sets an HttpOnly refresh-session cookie.',
  })
  @ApiBody({ type: LoginRequestDto })
  @ApiOkResponse({
    type: LoginResponseDto,
    description: 'Login succeeded and the refresh-session cookie was set.',
  })
  @ApiBadRequestResponse({ description: 'The login input is invalid.' })
  @ApiUnauthorizedResponse({ description: 'The credentials are invalid.' })
  @ApiInternalServerErrorResponse({ description: 'An unexpected sanitized failure occurred.' })
  async login(
    @Body() request: LoginRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    try {
      const result = await this.loginCustomer.execute(request);
      const responseBody = mapLoginResponse(result);

      response.cookie(
        refreshTokenCookieName,
        result.rawRefreshToken,
        this.refreshTokenCookiePolicy.getOptions(),
      );

      return responseBody;
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
      }

      throw error;
    }
  }
}
