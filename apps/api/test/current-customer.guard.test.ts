import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { GetCurrentUserUseCase } from '../src/auth/application/get-current-user.use-case.js';
import { CurrentCustomerGuard } from '../src/auth/presentation/current-customer.guard.js';

describe('CurrentCustomerGuard', () => {
  it('attaches only the verified user ID and replaces untrusted prior principal data', async () => {
    const userId = 'df4e7850-e329-4679-91f1-77b409d93f4f';
    const useCase = new GetCurrentUserUseCase(
      { issue: vi.fn(), verify: vi.fn().mockResolvedValue({ subject: userId }) },
      {
        create: vi.fn(),
        findAuthenticationByEmail: vi.fn(),
        updateCurrentUserProfile: vi.fn(),
        findPublicById: vi.fn().mockResolvedValue({
          id: userId,
          firstName: 'Private',
          email: 'private@example.invalid',
          lastName: null,
        }),
      },
    );
    const request = {
      headers: { authorization: 'Bearer test-only-value' },
      currentCustomer: { userId: 'spoofed', claims: 'not-allowed' },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
    expect(await new CurrentCustomerGuard(useCase).canActivate(context)).toBe(true);
    expect(request.currentCustomer).toEqual({ userId });
    expect(Object.isFrozen(request.currentCustomer)).toBe(true);
  });
});
