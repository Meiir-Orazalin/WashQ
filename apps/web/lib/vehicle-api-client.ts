import {
  createVehicleRequestSchema,
  createVehicleResponseSchema,
  vehicleListResponseSchema,
  apiErrorResponseSchema,
  type CreateVehicleInput,
  updateVehicleRequestSchema,
  updateVehicleResponseSchema,
  vehicleIdParamsSchema,
  type UpdateVehicleRequest,
} from '@washqueue/contracts';
import { ApiClientError } from './api-client';
import { publicEnvironment } from './environment';

async function requestVehicles(
  accessToken: string,
  options: RequestInit,
  vehicleId?: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(
      `${publicEnvironment.NEXT_PUBLIC_API_BASE_URL}/vehicles${vehicleId ? `/${vehicleId}` : ''}`,
      {
        ...options,
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
  } catch {
    throw new ApiClientError('The vehicle request could not be completed');
  }
  if (options.method === 'DELETE' && response.ok) {
    if (response.status !== 204)
      throw new ApiClientError('The API returned an invalid vehicle response');
    return undefined;
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

export async function updateVehicle(
  accessToken: string,
  vehicleId: string,
  input: UpdateVehicleRequest,
  signal?: AbortSignal,
) {
  const params = vehicleIdParamsSchema.safeParse({ vehicleId });
  const values = updateVehicleRequestSchema.safeParse(input);
  if (!params.success || !values.success)
    throw new ApiClientError('Invalid vehicle data', 400, 'VALIDATION_ERROR');
  const payload = await requestVehicles(
    accessToken,
    {
      method: 'PATCH',
      body: JSON.stringify(values.data),
      ...(signal ? { signal } : {}),
    },
    params.data.vehicleId,
  );
  const parsed = updateVehicleResponseSchema.safeParse(payload);
  if (!parsed.success) throw new ApiClientError('The API returned an invalid vehicle response');
  return parsed.data;
}

export async function deleteVehicle(
  accessToken: string,
  vehicleId: string,
  signal?: AbortSignal,
): Promise<void> {
  const params = vehicleIdParamsSchema.safeParse({ vehicleId });
  if (!params.success) throw new ApiClientError('Invalid vehicle data', 400, 'VALIDATION_ERROR');
  await requestVehicles(
    accessToken,
    { method: 'DELETE', ...(signal ? { signal } : {}) },
    params.data.vehicleId,
  );
}
