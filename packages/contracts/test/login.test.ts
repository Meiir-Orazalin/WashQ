import { describe, expect, it } from 'vitest';
import {
  loginRequestSchema,
  loginResponseSchema,
  type LoginRequest,
  type LoginResponse,
} from '../src/index.js';

const validLogin = {
  email: 'meiir@example.com',
  password: 'example-password',
} satisfies LoginRequest;

const validResponse = {
  user: {
    id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
    firstName: 'Meiir',
    lastName: 'Orazalin',
    email: 'meiir@example.com',
  },
  accessToken: 'signed-access-token',
  accessTokenExpiresAt: '2026-07-27T12:15:00.000Z',
} satisfies LoginResponse;

describe('login request contract', () => {
  it('parses a valid request', () => {
    expect(loginRequestSchema.parse(validLogin)).toEqual(validLogin);
  });

  it('normalizes email casing and surrounding whitespace', () => {
    const login = loginRequestSchema.parse({
      ...validLogin,
      email: '  Meiir@Example.COM ',
    });

    expect(login.email).toBe('meiir@example.com');
  });

  it('rejects an invalid email', () => {
    expect(() => loginRequestSchema.parse({ ...validLogin, email: 'not-an-email' })).toThrow();
  });

  it('rejects a missing password', () => {
    expect(() => loginRequestSchema.parse({ email: validLogin.email })).toThrow();
  });

  it('rejects a password longer than 128 characters', () => {
    expect(() => loginRequestSchema.parse({ ...validLogin, password: 'p'.repeat(129) })).toThrow();
  });

  it('rejects unknown fields', () => {
    expect(() =>
      loginRequestSchema.parse({ ...validLogin, organizationId: 'not-accepted' }),
    ).toThrow();
  });
});

describe('login response contract', () => {
  it('parses a valid successful response', () => {
    expect(loginResponseSchema.parse(validResponse)).toEqual(validResponse);
  });

  it('rejects a response containing a refresh token', () => {
    expect(() =>
      loginResponseSchema.parse({ ...validResponse, refreshToken: 'must-not-be-json' }),
    ).toThrow();
  });

  it('rejects a response containing a password hash', () => {
    expect(() =>
      loginResponseSchema.parse({
        ...validResponse,
        user: { ...validResponse.user, passwordHash: 'must-not-be-json' },
      }),
    ).toThrow();
  });
});
