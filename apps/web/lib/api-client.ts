import { healthResponseSchema, type HealthResponse } from '@washqueue/contracts';
import { publicEnvironment } from './environment';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export async function fetchApiHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch(`${publicEnvironment.NEXT_PUBLIC_API_BASE_URL}/health`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    throw new ApiClientError('The API health check failed', response.status);
  }

  const payload: unknown = await response.json();
  const parsed = healthResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiClientError('The API returned an invalid health response');
  }

  return parsed.data;
}
