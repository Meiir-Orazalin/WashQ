import { describe, expect, it } from 'vitest';
import { refreshResponseSchema, type RefreshResponse } from '../src/index.js';

const validResponse = {
  accessToken: 'signed-access-token',
  accessTokenExpiresAt: '2026-07-27T12:15:00.000Z',
} satisfies RefreshResponse;

describe('refresh response contract', () => {
  it('parses a valid response', () => {
    expect(refreshResponseSchema.parse(validResponse)).toEqual(validResponse);
  });

  it('rejects an invalid expiration timestamp', () => {
    expect(() =>
      refreshResponseSchema.parse({
        ...validResponse,
        accessTokenExpiresAt: 'not-a-timestamp',
      }),
    ).toThrow();
  });

  it('rejects a missing access token', () => {
    expect(() =>
      refreshResponseSchema.parse({
        accessTokenExpiresAt: validResponse.accessTokenExpiresAt,
      }),
    ).toThrow();
  });

  it('rejects unknown fields', () => {
    expect(() => refreshResponseSchema.parse({ ...validResponse, unknown: true })).toThrow();
  });

  it('rejects a refresh token', () => {
    expect(() =>
      refreshResponseSchema.parse({ ...validResponse, refreshToken: 'must-not-be-json' }),
    ).toThrow();
  });

  it.each(['sessionId', 'familyId', 'replacedBySessionId'])(
    'rejects the %s session identifier',
    (field) => {
      expect(() =>
        refreshResponseSchema.parse({ ...validResponse, [field]: 'not-public' }),
      ).toThrow();
    },
  );
});
