import type { RefreshResponse } from '@washqueue/contracts';
import { refreshSession } from './api-client';

export interface RefreshCoordinator {
  refresh(): Promise<RefreshResponse>;
}

export function createRefreshCoordinator(
  requestRefresh: () => Promise<RefreshResponse> = refreshSession,
): RefreshCoordinator {
  let inFlight: Promise<RefreshResponse> | null = null;

  return {
    refresh() {
      if (inFlight) {
        return inFlight;
      }

      const request = requestRefresh();
      const trackedRequest = request.finally(() => {
        if (inFlight === trackedRequest) {
          inFlight = null;
        }
      });
      inFlight = trackedRequest;

      return trackedRequest;
    },
  };
}

export const refreshCoordinator = createRefreshCoordinator();
