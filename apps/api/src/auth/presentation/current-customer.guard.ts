import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AuthenticationRequiredError,
  GetCurrentUserUseCase,
} from '../application/get-current-user.use-case.js';
import { readBearerToken } from './bearer-token.reader.js';

export interface CurrentCustomerRequest extends Request {
  currentCustomer?: Readonly<{ userId: string }>;
}

@Injectable()
export class CurrentCustomerGuard implements CanActivate {
  constructor(
    @Inject(GetCurrentUserUseCase) private readonly getCurrentUser: GetCurrentUserUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CurrentCustomerRequest>();
    // Never trust a principal supplied by another request adapter.
    delete request.currentCustomer;
    try {
      const user = await this.getCurrentUser.execute({
        accessToken: readBearerToken(request.headers.authorization),
      });
      request.currentCustomer = Object.freeze({ userId: user.id });
      return true;
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        throw new UnauthorizedException({
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required',
        });
      }
      throw error;
    }
  }
}
