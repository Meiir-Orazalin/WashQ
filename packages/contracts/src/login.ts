import { z } from 'zod';

export const loginRequestSchema = z.strictObject({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, 'Email must contain at most 254 characters')
    .pipe(z.email('Enter a valid email address')),
  password: z
    .string()
    .min(1, 'Password is required')
    .max(128, 'Password must contain at most 128 characters'),
});

export const loginUserSchema = z.strictObject({
  id: z.uuid(),
  firstName: z.string().min(2).max(60),
  lastName: z.string().min(2).max(60).nullable(),
  email: z.email().max(254),
});

export const loginResponseSchema = z.strictObject({
  user: loginUserSchema,
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.iso.datetime({ offset: true }),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginUser = z.infer<typeof loginUserSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
