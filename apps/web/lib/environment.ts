import { z } from 'zod';

const publicEnvironmentSchema = z.strictObject({
  NEXT_PUBLIC_API_BASE_URL: z.url().transform((url) => url.replace(/\/$/, '')),
});

export const publicEnvironment = publicEnvironmentSchema.parse({
  NEXT_PUBLIC_API_BASE_URL:
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    (process.env.NODE_ENV === 'production' ? undefined : 'http://localhost:4000/api/v1'),
});
