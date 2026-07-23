import { z } from 'zod';

const publicEnvironmentSchema = z.strictObject({
  NEXT_PUBLIC_API_BASE_URL: z
    .url()
    .default('http://localhost:4000/api/v1')
    .transform((url) => url.replace(/\/$/, '')),
});

export const publicEnvironment = publicEnvironmentSchema.parse({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});
