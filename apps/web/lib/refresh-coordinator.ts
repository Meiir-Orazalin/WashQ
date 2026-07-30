import type { RefreshResponse } from '@washqueue/contracts';
import { refreshSession } from './api-client';

export interface RefreshCoordinator {
  refresh(): Promise<RefreshResponse>;
  waitForIdle(): Promise<void>;
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
    async waitForIdle() {
      const activeRequest = inFlight;
      if (!activeRequest) {
        return;
      }

      try {
        await activeRequest;
      } catch {
        // Logout only needs the cookie rotation attempt to settle before continuing.
      }
    },
  };
}

export const refreshCoordinator = createRefreshCoordinator();
