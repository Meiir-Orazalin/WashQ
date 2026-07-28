import { z } from 'zod';
import { loginUserSchema } from './login.js';

export const currentUserResponseSchema = z.strictObject({
  user: loginUserSchema,
});

export type CurrentUserResponse = z.infer<typeof currentUserResponseSchema>;
