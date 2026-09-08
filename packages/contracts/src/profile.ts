import { z } from 'zod';
import { registrationRequestSchema } from './registration.js';

/** Registration owns name normalization; omission is distinct from a nullable clear. */
export const updateCurrentUserProfileRequestSchema = z
  .strictObject({
    firstName: registrationRequestSchema.shape.firstName.optional(),
    lastName: registrationRequestSchema.shape.lastName,
  })
  .refine((value) => value.firstName !== undefined || value.lastName !== undefined, {
    message: 'Provide at least one name to update',
  });

export type UpdateCurrentUserProfileRequest = z.infer<typeof updateCurrentUserProfileRequestSchema>;
