import {
  apiErrorResponseSchema,
  branchIdParamsSchema,
  washBoxIdParamsSchema,
  createWashBoxRequestSchema,
  setWashBoxActiveStateRequestSchema,
  washBoxResponseSchema,
  washBoxListResponseSchema,
  type CreateWashBoxRequest,
  type SetWashBoxActiveStateRequest,
} from '@washqueue/contracts';
import { ApiClientError } from './api-client';
import { publicEnvironment } from './environment';

async function requestWashBox(
  token: string,
  organizationId: string,
  branchId: string,
  options: RequestInit,
  washBoxId?: string,
): Promise<unknown> {
  const params = washBoxId
    ? washBoxIdParamsSchema.safeParse({ organizationId, branchId, washBoxId })
    : branchIdParamsSchema.safeParse({ organizationId, branchId });
  if (!params.success)
    throw new ApiClientError('Invalid wash box address', 400, 'VALIDATION_ERROR');
  const path = `/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/wash-boxes${washBoxId ? `/${encodeURIComponent(washBoxId)}` : ''}`;
  let response: Response;
  try {
    response = await fetch(`${publicEnvironment.NEXT_PUBLIC_API_BASE_URL}${path}`, {
      ...options,
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new ApiClientError('The wash box request could not be completed');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError('Invalid wash box response', response.status);
  }
  // Even a transport/mock that ignores abort cannot deliver an old-resource 401 to auth.
  if (options.signal?.aborted)
    throw new ApiClientError('The wash box request is no longer current');
  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(payload);
    throw new ApiClientError(
      'The wash box request failed',
      response.status,
      parsed.success ? parsed.data.error.code : undefined,
    );
  }
  return payload;
}
export async function createWashBox(
  token: string,
  organizationId: string,
  branchId: string,
  input: CreateWashBoxRequest,
  signal?: AbortSignal,
) {
  const parsed = createWashBoxRequestSchema.safeParse(input);
  if (!parsed.success) throw new ApiClientError('Invalid wash box data', 400, 'VALIDATION_ERROR');
  const result = washBoxResponseSchema.safeParse(
    await requestWashBox(token, organizationId, branchId, {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      ...(signal ? { signal } : {}),
    }),
  );
  if (!result.success) throw new ApiClientError('Invalid wash box response');
  return result.data;
}
export async function listWashBoxes(
  token: string,
  organizationId: string,
  branchId: string,
  signal?: AbortSignal,
) {
  const result = washBoxListResponseSchema.safeParse(
    await requestWashBox(token, organizationId, branchId, {
      method: 'GET',
      ...(signal ? { signal } : {}),
    }),
  );
  if (!result.success) throw new ApiClientError('Invalid wash box response');
  return result.data;
}
export async function getWashBox(
  token: string,
  organizationId: string,
  branchId: string,
  washBoxId: string,
  signal?: AbortSignal,
) {
  const result = washBoxResponseSchema.safeParse(
    await requestWashBox(
      token,
      organizationId,
      branchId,
      { method: 'GET', ...(signal ? { signal } : {}) },
      washBoxId,
    ),
  );
  if (!result.success) throw new ApiClientError('Invalid wash box response');
  return result.data;
}
export async function setWashBoxActiveState(
  token: string,
  organizationId: string,
  branchId: string,
  washBoxId: string,
  input: SetWashBoxActiveStateRequest,
  signal?: AbortSignal,
) {
  const parsed = setWashBoxActiveStateRequestSchema.safeParse(input);
  if (!parsed.success) throw new ApiClientError('Invalid wash box state', 400, 'VALIDATION_ERROR');
  const result = washBoxResponseSchema.safeParse(
    await requestWashBox(
      token,
      organizationId,
      branchId,
      { method: 'PATCH', body: JSON.stringify(parsed.data), ...(signal ? { signal } : {}) },
      washBoxId,
    ),
  );
  if (!result.success) throw new ApiClientError('Invalid wash box response');
  return result.data;
}
