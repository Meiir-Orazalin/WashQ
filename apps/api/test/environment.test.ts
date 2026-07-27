import { describe, expect, it } from 'vitest';
import { environmentSchema, validateEnvironment } from '../src/config/environment.js';

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://washqueue:local-only@localhost:5432/washqueue',
};

describe('API environment validation', () => {
  it('uses production-safe defaults for optional settings', () => {
    const environment = environmentSchema.parse(requiredEnvironment);

    expect(environment.API_DOCS_ENABLED).toBe(false);
    expect(environment.CORS_ORIGINS).toEqual(['http://localhost:3000']);
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
