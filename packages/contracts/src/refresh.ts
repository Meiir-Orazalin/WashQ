import { z } from 'zod';

export const refreshResponseSchema = z.strictObject({
  accessToken: z.string().min(1),
  accessTokenExpiresAt: z.iso.datetime({ offset: true }),
});

export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
