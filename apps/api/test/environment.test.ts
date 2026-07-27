import { describe, expect, it } from 'vitest';
import { environmentSchema, validateEnvironment } from '../src/config/environment.js';

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://washqueue:local-only@localhost:5432/washqueue',
  ACCESS_TOKEN_SIGNING_SECRET: 'a'.repeat(48),
  ACCESS_TOKEN_LIFETIME_SECONDS: '900',
  REFRESH_TOKEN_LIFETIME_SECONDS: '2592000',
};

describe('API environment validation', () => {
  it('uses production-safe defaults for optional settings', () => {
    const environment = environmentSchema.parse(requiredEnvironment);

    expect(environment.API_DOCS_ENABLED).toBe(false);
    expect(environment.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('accepts valid explicit development authentication configuration', () => {
    const environment = environmentSchema.parse(requiredEnvironment);

    expect(environment.ACCESS_TOKEN_LIFETIME_SECONDS).toBe(900);
    expect(environment.REFRESH_TOKEN_LIFETIME_SECONDS).toBe(2_592_000);
  });

  it('rejects a missing access-token signing secret', () => {
    const environment: Record<string, unknown> = { ...requiredEnvironment };
    delete environment.ACCESS_TOKEN_SIGNING_SECRET;

    expect(() => environmentSchema.parse(environment)).toThrow();
  });

  it('rejects a weak access-token signing secret', () => {
    expect(() =>
      environmentSchema.parse({
        ...requiredEnvironment,
        ACCESS_TOKEN_SIGNING_SECRET: 'too-short',
      }),
    ).toThrow();
  });

  it.each([
    ['access-token', { ACCESS_TOKEN_LIFETIME_SECONDS: '0' }],
    ['refresh-token', { REFRESH_TOKEN_LIFETIME_SECONDS: 'not-a-number' }],
    [
      'refresh-token shorter than access-token',
      {
        ACCESS_TOKEN_LIFETIME_SECONDS: '3600',
        REFRESH_TOKEN_LIFETIME_SECONDS: '3600',
      },
    ],
  ])('rejects an invalid %s lifetime', (_name, override) => {
    expect(() =>
      environmentSchema.parse({
        ...requiredEnvironment,
        ...override,
      }),
    ).toThrow();
  });

  it('rejects an unsafe production placeholder', () => {
    expect(() =>
      environmentSchema.parse({
        ...requiredEnvironment,
        NODE_ENV: 'production',
        ACCESS_TOKEN_SIGNING_SECRET: 'development-only-change-me-access-token-signing-secret',
      }),
    ).toThrow();
  });

  it('does not include an authentication secret in validation errors', () => {
    const sensitiveValue = 'sensitive-but-weak';

    try {
      validateEnvironment({
        ...requiredEnvironment,
        ACCESS_TOKEN_SIGNING_SECRET: sensitiveValue,
      });
    } catch (error) {
      expect(String(error)).toContain('ACCESS_TOKEN_SIGNING_SECRET');
      expect(String(error)).not.toContain(sensitiveValue);
    }
  });

  it('reports invalid field names without echoing sensitive values', () => {
    const sensitiveValue = 'not-a-database-url-with-a-password';

    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        DATABASE_URL: sensitiveValue,
      }),
    ).toThrow('Invalid application environment: DATABASE_URL');

    try {
      validateEnvironment({
        ...requiredEnvironment,
        DATABASE_URL: sensitiveValue,
      });
    } catch (error) {
      expect(String(error)).not.toContain(sensitiveValue);
    }
  });
});
