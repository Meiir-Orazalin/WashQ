import { createWashBoxRequestSchema } from '@washqueue/contracts';
import { ApiClientError } from './api-client';
export function validateWashBoxNumber(value: string) {
  // Convert the entire integer control deliberately; never partially parse a string.
  return createWashBoxRequestSchema.safeParse({
    number: /^\d+$/.test(value) ? Number(value) : NaN,
  });
}
export function washBoxFailureMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === 'WASH_BOX_ALREADY_EXISTS')
      return 'This box number is already used in this branch, including inactive boxes.';
    if (error.code === 'ORGANIZATION_NOT_FOUND') return 'This organization is no longer available.';
    if (error.code === 'BRANCH_NOT_FOUND') return 'This branch is no longer available.';
    if (error.code === 'WASH_BOX_NOT_FOUND') return 'This wash box is no longer available.';
  }
  return 'The wash box request could not be completed. Please try again.';
}
