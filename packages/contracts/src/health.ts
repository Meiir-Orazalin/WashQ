import { z } from 'zod';

export const serviceName = 'washqueue-api' as const;

export const healthResponseSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.literal(serviceName),
  timestamp: z.iso.datetime({ offset: true }),
});

export const readinessResponseSchema = healthResponseSchema.extend({
  checks: z.strictObject({
    database: z.literal('up'),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
