import { loginResponseSchema, type LoginResponse } from '@washqueue/contracts';
import type { LoginCustomerResult } from '../application/login-customer.use-case.js';

export function mapLoginResponse(result: LoginCustomerResult): LoginResponse {
  return loginResponseSchema.parse({
    user: result.user,
    accessToken: result.accessToken,
    accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
  });
}
