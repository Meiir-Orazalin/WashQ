import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const insecureProductionSecretPattern = /change[-_ ]?me|development|placeholder|test[-_ ]?only/i;

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    DATABASE_URL: z
      .url()
      .refine(
        (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
        'DATABASE_URL must use the PostgreSQL protocol',
      ),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url()).min(1)),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose']).default('log'),
    API_DOCS_ENABLED: booleanFromString,
    ACCESS_TOKEN_SIGNING_SECRET: z.string().min(32),
    ACCESS_TOKEN_LIFETIME_SECONDS: z.coerce.number().int().min(60).max(3_600),
    REFRESH_TOKEN_LIFETIME_SECONDS: z.coerce.number().int().min(3_600).max(31_536_000),
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === 'production' &&
      insecureProductionSecretPattern.test(environment.ACCESS_TOKEN_SIGNING_SECRET)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Production access-token signing secret is insecure',
        path: ['ACCESS_TOKEN_SIGNING_SECRET'],
      });
    }

    if (environment.REFRESH_TOKEN_LIFETIME_SECONDS <= environment.ACCESS_TOKEN_LIFETIME_SECONDS) {
      context.addIssue({
        code: 'custom',
        message: 'Refresh-token lifetime must exceed access-token lifetime',
        path: ['REFRESH_TOKEN_LIFETIME_SECONDS'],
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(config: Record<string, unknown>): Environment {
  const result = environmentSchema.safeParse(config);

  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid application environment: ${fields}`);
  }

  return result.data;
}
