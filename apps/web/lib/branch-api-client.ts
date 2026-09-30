import {
  apiErrorResponseSchema,
  branchIdParamsSchema,
  organizationIdParamsSchema,
  createBranchRequestSchema,
  createBranchResponseSchema,
  branchListResponseSchema,
  branchDetailResponseSchema,
  replaceOpeningHoursRequestSchema,
  openingHoursResponseSchema,
  type CreateBranchRequest,
  type ReplaceOpeningHoursRequest,
} from '@washqueue/contracts';
import { ApiClientError } from './api-client';
import { publicEnvironment } from './environment';

async function requestBranch(
  token: string,
  organizationId: string,
  options: RequestInit,
  branchId?: string,
  schedule = false,
): Promise<unknown> {
  const valid = branchId
    ? branchIdParamsSchema.safeParse({ organizationId, branchId })
    : organizationIdParamsSchema.safeParse({ organizationId });
  if (!valid.success) throw new ApiClientError('Invalid branch address', 400, 'VALIDATION_ERROR');
  const path = `/organizations/${encodeURIComponent(organizationId)}/branches${branchId ? `/${encodeURIComponent(branchId)}` : ''}${schedule ? '/opening-hours' : ''}`;
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
    throw new ApiClientError('The branch request could not be completed');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError('Invalid branch response', response.status);
  }
  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(payload);
    throw new ApiClientError(
      'The branch request failed',
      response.status,
      parsed.success ? parsed.data.error.code : undefined,
    );
  }
  return payload;
}
export async function createBranch(
  token: string,
  organizationId: string,
  input: CreateBranchRequest,
  signal?: AbortSignal,
) {
  const parsed = createBranchRequestSchema.safeParse(input);
  if (!parsed.success) throw new ApiClientError('Invalid branch data', 400, 'VALIDATION_ERROR');
  const result = createBranchResponseSchema.safeParse(
    await requestBranch(token, organizationId, {
      method: 'POST',
      body: JSON.stringify(parsed.data),
      ...(signal ? { signal } : {}),
    }),
  );
  if (!result.success) throw new ApiClientError('Invalid branch response');
  return result.data;
}
export async function listOwnedBranches(
  token: string,
  organizationId: string,
  signal?: AbortSignal,
) {
  const result = branchListResponseSchema.safeParse(
    await requestBranch(token, organizationId, { method: 'GET', ...(signal ? { signal } : {}) }),
  );
  if (!result.success) throw new ApiClientError('Invalid branch response');
  return result.data;
}
export async function getOwnedBranch(
  token: string,
  organizationId: string,
  branchId: string,
  signal?: AbortSignal,
) {
  const result = branchDetailResponseSchema.safeParse(
    await requestBranch(
      token,
      organizationId,
      { method: 'GET', ...(signal ? { signal } : {}) },
      branchId,
    ),
  );
  if (!result.success) throw new ApiClientError('Invalid branch response');
  return result.data;
}
export async function replaceOpeningHours(
  token: string,
  organizationId: string,
  branchId: string,
  input: ReplaceOpeningHoursRequest,
  signal?: AbortSignal,
) {
  const parsed = replaceOpeningHoursRequestSchema.safeParse(input);
  if (!parsed.success) throw new ApiClientError('Invalid weekly schedule', 400, 'VALIDATION_ERROR');
  const result = openingHoursResponseSchema.safeParse(
    await requestBranch(
      token,
      organizationId,
      { method: 'PUT', body: JSON.stringify(parsed.data), ...(signal ? { signal } : {}) },
      branchId,
      true,
    ),
  );
  if (!result.success) throw new ApiClientError('Invalid opening-hours response');
  return result.data;
}
