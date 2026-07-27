import { z } from 'zod';

const requiredNameSchema = z
  .string()
  .trim()
  .min(2, 'First name must contain at least 2 characters')
  .max(60, 'First name must contain at most 60 characters');

const optionalNameSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .pipe(
    z
      .string()
      .min(2, 'Last name must contain at least 2 characters')
      .max(60, 'Last name must contain at most 60 characters')
      .nullable(),
  )
  .nullable()
  .optional();

export const registrationRequestSchema = z.strictObject({
  firstName: requiredNameSchema,
  lastName: optionalNameSchema,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, 'Email must contain at most 254 characters')
    .pipe(z.email('Enter a valid email address')),
  password: z
    .string()
    .min(8, 'Password must contain at least 8 characters')
    .max(128, 'Password must contain at most 128 characters'),
});

export const registrationUserSchema = z.strictObject({
  id: z.uuid(),
  firstName: z.string().min(2).max(60),
  lastName: z.string().min(2).max(60).nullable(),
  email: z.email().max(254),
  createdAt: z.iso.datetime({ offset: true }),
});

export const registrationResponseSchema = z.strictObject({
  user: registrationUserSchema,
});

export type RegistrationRequest = z.infer<typeof registrationRequestSchema>;
export type RegistrationUser = z.infer<typeof registrationUserSchema>;
export type RegistrationResponse = z.infer<typeof registrationResponseSchema>;
