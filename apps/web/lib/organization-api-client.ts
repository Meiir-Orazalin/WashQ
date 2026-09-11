import {
  apiErrorResponseSchema,
  createOrganizationRequestSchema,
  createOrganizationResponseSchema,
  organizationListResponseSchema,
  organizationDetailResponseSchema,
  organizationIdParamsSchema,
  type CreateOrganizationInput,
} from '@washqueue/contracts';
import { ApiClientError } from './api-client';
import { publicEnvironment } from './environment';

async function requestOrganizations(
  accessToken: string,
  options: RequestInit,
  organizationId?: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(
      `${publicEnvironment.NEXT_PUBLIC_API_BASE_URL}/organizations${organizationId ? `/${organizationId}` : ''}`,
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
    throw new ApiClientError('The organization request could not be completed');
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError('The API returned an invalid organization response', response.status);
  }
  if (!response.ok) {
    const parsed = apiErrorResponseSchema.safeParse(payload);
    throw new ApiClientError(
      'The organization request failed',
      response.status,
      parsed.success ? parsed.data.error.code : undefined,
    );
  }
  return payload;
}

export async function createOrganization(
  accessToken: string,
  input: CreateOrganizationInput,
  signal?: AbortSignal,
) {
  const values = createOrganizationRequestSchema.safeParse(input);
  if (!values.success)
    throw new ApiClientError('Invalid organization data', 400, 'VALIDATION_ERROR');
  const payload = await requestOrganizations(accessToken, {
    method: 'POST',
    body: JSON.stringify(values.data),
    ...(signal ? { signal } : {}),
  });
  const parsed = createOrganizationResponseSchema.safeParse(payload);
  if (!parsed.success)
    throw new ApiClientError('The API returned an invalid organization response');
  return parsed.data;
}

export async function listOwnedOrganizations(accessToken: string, signal?: AbortSignal) {
  const payload = await requestOrganizations(accessToken, {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
  const parsed = organizationListResponseSchema.safeParse(payload);
  if (!parsed.success)
    throw new ApiClientError('The API returned an invalid organization response');
  return parsed.data;
}

export async function getOwnedOrganization(
  accessToken: string,
  organizationId: string,
  signal?: AbortSignal,
) {
  const params = organizationIdParamsSchema.safeParse({ organizationId });
  if (!params.success) throw new ApiClientError('Invalid organization ID', 400, 'VALIDATION_ERROR');
  const payload = await requestOrganizations(
    accessToken,
    { method: 'GET', ...(signal ? { signal } : {}) },
    params.data.organizationId,
  );
  const parsed = organizationDetailResponseSchema.safeParse(payload);
  if (!parsed.success)
    throw new ApiClientError('The API returned an invalid organization response');
  return parsed.data;
}
