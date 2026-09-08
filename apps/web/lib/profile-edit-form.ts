import { updateCurrentUserProfileRequestSchema } from '@washqueue/contracts';

export const profileEditFields = [
  { name: 'firstName', label: 'First name', autoComplete: 'given-name' },
  { name: 'lastName', label: 'Last name (optional)', autoComplete: 'family-name' },
] as const;
export type ProfileEditField = (typeof profileEditFields)[number]['name'];
export type ProfileEditValues = Record<ProfileEditField, string>;

export function validateProfileEdit(initial: ProfileEditValues, values: ProfileEditValues) {
  return updateCurrentUserProfileRequestSchema.safeParse({
    ...(values.firstName !== initial.firstName ? { firstName: values.firstName } : {}),
    ...(values.lastName !== initial.lastName ? { lastName: values.lastName } : {}),
  });
}
