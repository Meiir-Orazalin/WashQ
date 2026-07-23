import { z } from 'zod';

export const apiErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
  timestamp: z.iso.datetime({ offset: true }),
  path: z.string().startsWith('/'),
  requestId: z.string().min(1),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
