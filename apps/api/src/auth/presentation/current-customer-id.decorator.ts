import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { CurrentCustomerRequest } from './current-customer.guard.js';

export const CurrentCustomerId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const principal = context.switchToHttp().getRequest<CurrentCustomerRequest>().currentCustomer;
    if (!principal) {
      throw new UnauthorizedException({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required',
      });
    }
    return principal.userId;
  },
);
