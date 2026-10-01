import {
  createBranchServiceRequestSchema,
  updateBranchServiceRequestSchema,
  type PublicBranchService,
} from '@washqueue/contracts';
import { ApiClientError } from './api-client';
import { kztPriceInput, parseKztPrice } from './kzt-price';

export interface BranchServiceFields {
  name: string;
  description: string;
  durationMinutes: string;
  price: string;
}
export const emptyBranchServiceFields: BranchServiceFields = {
  name: '',
  description: '',
  durationMinutes: '',
  price: '',
};
export function serviceEditFields(service: PublicBranchService): BranchServiceFields {
  return {
    name: service.name,
    description: service.description ?? '',
    durationMinutes: String(service.durationMinutes),
    price: kztPriceInput(service.priceMinor),
  };
}
export function validateServiceForm(fields: BranchServiceFields, original?: PublicBranchService) {
  const duration = /^\d{1,4}$/u.test(fields.durationMinutes.trim())
    ? Number(fields.durationMinutes.trim())
    : null;
  const priceMinor = parseKztPrice(fields.price);
  const candidate = {
    name: fields.name,
    description: fields.description,
    durationMinutes: duration,
    priceMinor,
    currency: 'KZT',
  };
  const parsed = createBranchServiceRequestSchema.safeParse(candidate);
  const errors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] === 'priceMinor' ? 'price' : String(issue.path[0] ?? 'form');
      errors[field] ??=
        field === 'price'
          ? 'Enter a KZT price from 0.01 to 1000000, with at most two decimal digits.'
          : issue.message;
    }
    return { result: parsed, errors };
  }
  if (!original) return { result: parsed, errors };
  const patch: Record<string, unknown> = {};
  for (const field of ['name', 'description', 'durationMinutes', 'priceMinor'] as const)
    if (parsed.data[field] !== original[field]) patch[field] = parsed.data[field];
  const result = updateBranchServiceRequestSchema.safeParse(patch);
  if (!result.success) errors.form = 'Change at least one service field.';
  return { result, errors };
}
export function serviceFailureMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'ORGANIZATION_NOT_FOUND') return 'The organization was not found.';
    if (error.code === 'BRANCH_NOT_FOUND') return 'The branch was not found.';
    if (error.code === 'SERVICE_NOT_FOUND') return 'This service is no longer available.';
    if (error.status === 401) return 'Sign in again to manage services.';
  }
  return 'The service request could not be completed. Please try again.';
}

export function serviceCreationFailureMessage(error: unknown): string {
  if (error instanceof ApiClientError && (error.status === undefined || error.status >= 500))
    return 'The creation result could not be confirmed. Check the list before creating again.';
  return serviceFailureMessage(error);
}
