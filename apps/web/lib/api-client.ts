import {
  apiErrorResponseSchema,
  currentUserResponseSchema,
  healthResponseSchema,
  loginResponseSchema,
  registrationResponseSchema,
  type CurrentUserResponse,
  type HealthResponse,
  type LoginRequest,
  type LoginResponse,
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

export async function loginCustomer(login: LoginRequest): Promise<LoginResponse> {
  let response: Response;
  try {
    response = await fetch(`${publicEnvironment.NEXT_PUBLIC_API_BASE_URL}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(login),
    });
  } catch {
    throw new ApiClientError('The login request could not be completed');
  }

  const payload = await readJson(response, 'The API returned an invalid login response');

  if (!response.ok) {
    throw toApiClientError(payload, response.status, 'Login failed');
  }

  const parsed = loginResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError('The API returned an invalid login response');
  }

  return parsed.data;
}

export async function getCurrentUser(accessToken: string): Promise<CurrentUserResponse> {
  let response: Response;
  try {
    response = await fetch(`${publicEnvironment.NEXT_PUBLIC_API_BASE_URL}/auth/me`, {
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new ApiClientError('The current user request could not be completed');
  }

  const payload = await readJson(response, 'The API returned an invalid current-user response');

  if (!response.ok) {
    throw toApiClientError(payload, response.status, 'Current user verification failed');
  }

  const parsed = currentUserResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError('The API returned an invalid current-user response');
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

async function readJson(response: Response, invalidResponseMessage: string): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ApiClientError(invalidResponseMessage, response.status);
  }
}

function toApiClientError(
  payload: unknown,
  status: number,
  fallbackMessage: string,
): ApiClientError {
  const apiError = apiErrorResponseSchema.safeParse(payload);
  return new ApiClientError(
    fallbackMessage,
    status,
    apiError.success ? apiError.data.error.code : undefined,
  );
}
