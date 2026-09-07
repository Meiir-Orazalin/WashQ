import {
  createVehicleRequestSchema,
  createVehicleResponseSchema,
  vehicleListResponseSchema,
  apiErrorResponseSchema,
  type CreateVehicleInput,
} from '@washqueue/contracts';
import { ApiClientError } from './api-client';
import { publicEnvironment } from './environment';

async function requestVehicles(accessToken: string, options: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${publicEnvironment.NEXT_PUBLIC_API_BASE_URL}/vehicles`, {
      ...options,
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new ApiClientError('The vehicle request could not be completed');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError('The API returned an invalid vehicle response', response.status);
  }
  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(payload);
    throw new ApiClientError(
      'The vehicle request failed',
      response.status,
      parsed.success ? parsed.data.error.code : undefined,
    );
  }
  return payload;
}

export async function createVehicle(
  accessToken: string,
  input: CreateVehicleInput,
  signal?: AbortSignal,
) {
  const values = createVehicleRequestSchema.safeParse(input);
  if (!values.success) throw new ApiClientError('Invalid vehicle data', 400, 'VALIDATION_ERROR');
  const payload = await requestVehicles(accessToken, {
    method: 'POST',
    body: JSON.stringify(values.data),
    ...(signal ? { signal } : {}),
  });
  const parsed = createVehicleResponseSchema.safeParse(payload);
  if (!parsed.success) throw new ApiClientError('The API returned an invalid vehicle response');
  return parsed.data;
}

export async function listVehicles(accessToken: string, signal?: AbortSignal) {
  const payload = await requestVehicles(accessToken, {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
  const parsed = vehicleListResponseSchema.safeParse(payload);
  if (!parsed.success) throw new ApiClientError('The API returned an invalid vehicle response');
  return parsed.data;
}
