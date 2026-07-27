import {
  apiErrorResponseSchema,
  healthResponseSchema,
  registrationResponseSchema,
  type HealthResponse,
  type RegistrationRequest,
  type RegistrationResponse,
} from '@washqueue/contracts';
import { publicEnvironment } from './environment';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export async function registerCustomer(
  registration: RegistrationRequest,
): Promise<RegistrationResponse> {
  const response = await fetch(`${publicEnvironment.NEXT_PUBLIC_API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(registration),
  });

  const payload: unknown = await response.json();

  if (!response.ok) {
    const apiError = apiErrorResponseSchema.safeParse(payload);
    throw new ApiClientError(
      apiError.success ? apiError.data.error.message : 'Registration failed',
      response.status,
      apiError.success ? apiError.data.error.code : undefined,
    );
  }

  const parsed = registrationResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError('The API returned an invalid registration response');
  }

  return parsed.data;
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
