import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Headers,
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
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { LoginResponse, RegistrationResponse } from '@washqueue/contracts';
import type { RefreshResponse } from '@washqueue/contracts';
import type { Response } from 'express';
import {
  InvalidCredentialsError,
  LoginCustomerUseCase,
} from '../application/login-customer.use-case.js';
import { LogoutCurrentSessionUseCase } from '../application/logout-current-session.use-case.js';
import { RegisterCustomerUseCase } from '../application/register-customer.use-case.js';
import {
  InvalidRefreshSessionError,
  RotateRefreshSessionUseCase,
} from '../application/rotate-refresh-session.use-case.js';
import { DuplicateUserEmailError } from '../../users/application/user-repository.js';
import { LoginRequestDto } from './login-request.dto.js';
import { LoginResponseDto } from './login-response.dto.js';
import { mapLoginResponse } from './login-response.mapper.js';
import { RefreshRequestOriginPolicy } from './refresh-request-origin.policy.js';
import { RefreshResponseDto } from './refresh-response.dto.js';
import { mapRefreshResponse } from './refresh-response.mapper.js';
import { readRefreshTokenCookie } from './refresh-token-cookie.reader.js';
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
    @Inject(RotateRefreshSessionUseCase)
    private readonly rotateRefreshSession: RotateRefreshSessionUseCase,
    @Inject(LogoutCurrentSessionUseCase)
    private readonly logoutCurrentSession: LogoutCurrentSessionUseCase,
    @Inject(RefreshRequestOriginPolicy)
    private readonly refreshRequestOriginPolicy: RefreshRequestOriginPolicy,
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

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('refresh-cookie')
  @ApiOperation({
    summary: 'Rotate a refresh session',
    description:
      'Uses the HttpOnly refresh cookie, validates browser Origin when present, rotates the cookie, and returns a new access token. Requests without Origin are accepted for trusted non-browser clients.',
  })
  @ApiOkResponse({
    type: RefreshResponseDto,
    description: 'The refresh session and cookie were rotated.',
  })
  @ApiUnauthorizedResponse({ description: 'The refresh session is invalid.' })
  @ApiForbiddenResponse({ description: 'The browser Origin is not allowed.' })
  @ApiInternalServerErrorResponse({ description: 'An unexpected sanitized failure occurred.' })
  async refresh(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RefreshResponse> {
    if (!this.refreshRequestOriginPolicy.isAllowed(origin)) {
      throw new ForbiddenException({
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'The request origin is not allowed',
      });
    }

    try {
      const result = await this.rotateRefreshSession.execute({
        rawRefreshToken: readRefreshTokenCookie(cookieHeader),
      });
      const responseBody = mapRefreshResponse(result);

      response.cookie(
        refreshTokenCookieName,
        result.rawRefreshToken,
        this.refreshTokenCookiePolicy.getOptions(),
      );

      return responseBody;
    } catch (error) {
      if (error instanceof InvalidRefreshSessionError) {
        response.clearCookie(
          refreshTokenCookieName,
          this.refreshTokenCookiePolicy.getClearOptions(),
        );
        throw new UnauthorizedException({
          code: 'INVALID_REFRESH_SESSION',
          message: 'The refresh session is invalid',
        });
      }

      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth('refresh-cookie')
  @ApiOperation({
    summary: 'Log out the current refresh session',
    description:
      'Idempotently revokes only the session represented by the HttpOnly refresh cookie, validates browser Origin when present, and clears the cookie. Requests without Origin are accepted for trusted non-browser clients. Existing access tokens remain valid until expiration.',
  })
  @ApiNoContentResponse({
    description:
      'The current refresh session is no longer usable, if it existed, and the refresh cookie was cleared.',
  })
  @ApiForbiddenResponse({ description: 'The browser Origin is not allowed.' })
  @ApiInternalServerErrorResponse({ description: 'An unexpected sanitized failure occurred.' })
  async logout(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    if (!this.refreshRequestOriginPolicy.isAllowed(origin)) {
      throw new ForbiddenException({
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'The request origin is not allowed',
      });
    }

    try {
      await this.logoutCurrentSession.execute({
        rawRefreshToken: readRefreshTokenCookie(cookieHeader),
      });
    } finally {
      response.clearCookie(refreshTokenCookieName, this.refreshTokenCookiePolicy.getClearOptions());
    }
  }
}
