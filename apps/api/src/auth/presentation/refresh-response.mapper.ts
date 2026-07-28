import { refreshResponseSchema, type RefreshResponse } from '@washqueue/contracts';
import type { RotateRefreshSessionResult } from '../application/rotate-refresh-session.use-case.js';

export function mapRefreshResponse(result: RotateRefreshSessionResult): RefreshResponse {
  return refreshResponseSchema.parse({
    accessToken: result.accessToken,
    accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
  });
}
