import {
  apiErrorResponseSchema,
  branchIdParamsSchema,
  branchServiceIdParamsSchema,
  createBranchServiceRequestSchema,
  updateBranchServiceRequestSchema,
  branchServiceResponseSchema,
  branchServiceListResponseSchema,
  type CreateBranchServiceRequest,
  type UpdateBranchServiceRequest,
} from '@washqueue/contracts';
import { ApiClientError } from './api-client';
import { publicEnvironment } from './environment';

async function requestBranchService(
  token: string,
  organizationId: string,
  branchId: string,
  options: RequestInit,
  serviceId?: string,
): Promise<unknown> {
  const params = serviceId
    ? branchServiceIdParamsSchema.safeParse({ organizationId, branchId, serviceId })
    : branchIdParamsSchema.safeParse({ organizationId, branchId });
  if (!params.success)
    throw new ApiClientError('Invalid branch service address', 400, 'VALIDATION_ERROR');
  const path = `/organizations/${encodeURIComponent(organizationId)}/branches/${encodeURIComponent(branchId)}/services${serviceId ? `/${encodeURIComponent(serviceId)}` : ''}`;
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
    throw new ApiClientError('The branch service request could not be completed');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError('Invalid branch service response', response.status);
  }
  // Even a transport/mock that ignores abort cannot deliver an old-resource 401 to auth.
  if (options.signal?.aborted)
    throw new ApiClientError('The branch service request is no longer current');
  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(payload);
    throw new ApiClientError(
      'The branch service request failed',
      response.status,
      parsed.success ? parsed.data.error.code : undefined,
    );
  }
  return payload;
}
export async function createBranchService(
  token: string,
  organizationId: string,
  branchId: string,
  input: CreateBranchServiceRequest,
  signal?: AbortSignal,
) {
  const parsed = createBranchServiceRequestSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiClientError('Invalid branch service data', 400, 'VALIDATION_ERROR');
  const result = branchServiceResponseSchema.safeParse(
    await requestBranchService(token, organizationId, branchId, {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      ...(signal ? { signal } : {}),
    }),
  );
  if (!result.success) throw new ApiClientError('Invalid branch service response');
  return result.data;
}
export async function listBranchServices(
  token: string,
  organizationId: string,
  branchId: string,
  signal?: AbortSignal,
) {
  const result = branchServiceListResponseSchema.safeParse(
    await requestBranchService(token, organizationId, branchId, {
      method: 'GET',
      ...(signal ? { signal } : {}),
    }),
  );
  if (!result.success) throw new ApiClientError('Invalid branch service response');
  return result.data;
}
export async function getBranchService(
  token: string,
  organizationId: string,
  branchId: string,
  serviceId: string,
  signal?: AbortSignal,
) {
  const result = branchServiceResponseSchema.safeParse(
    await requestBranchService(
      token,
      organizationId,
      branchId,
      { method: 'GET', ...(signal ? { signal } : {}) },
      serviceId,
    ),
  );
  if (!result.success) throw new ApiClientError('Invalid branch service response');
  return result.data;
}
export async function updateBranchService(
  token: string,
  organizationId: string,
  branchId: string,
  serviceId: string,
  input: UpdateBranchServiceRequest,
  signal?: AbortSignal,
) {
  const parsed = updateBranchServiceRequestSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiClientError('Invalid branch service state', 400, 'VALIDATION_ERROR');
  const result = branchServiceResponseSchema.safeParse(
    await requestBranchService(
      token,
      organizationId,
      branchId,
      { method: 'PATCH', body: JSON.stringify(parsed.data), ...(signal ? { signal } : {}) },
      serviceId,
    ),
  );
  if (!result.success) throw new ApiClientError('Invalid branch service response');
  return result.data;
}
