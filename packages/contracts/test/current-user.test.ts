import { describe, expect, it } from 'vitest';
import { currentUserResponseSchema, type CurrentUserResponse } from '../src/index.js';

const validResponse = {
  user: {
    id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
    firstName: 'Meiir',
    lastName: 'Orazalin',
    email: 'meiir@example.com',
  },
} satisfies CurrentUserResponse;

describe('current-user response contract', () => {
  it('parses a valid public user response', () => {
    expect(currentUserResponseSchema.parse(validResponse)).toEqual(validResponse);
  });

  it('accepts a nullable last name', () => {
    const response = {
      user: {
        ...validResponse.user,
        lastName: null,
      },
    };

    expect(currentUserResponseSchema.parse(response)).toEqual(response);
  });

  it.each([
    {
      name: 'an invalid UUID',
      response: {
        user: { ...validResponse.user, id: 'not-a-uuid' },
      },
    },
    {
      name: 'an invalid email',
      response: {
        user: { ...validResponse.user, email: 'not-an-email' },
      },
    },
    {
      name: 'a missing user',
      response: {},
    },
    {
      name: 'an unknown root field',
      response: { ...validResponse, organizationId: 'not-accepted' },
    },
    {
      name: 'a password',
      response: {
        user: { ...validResponse.user, password: 'must-not-be-json' },
      },
    },
    {
      name: 'a password hash',
      response: {
        user: { ...validResponse.user, passwordHash: 'must-not-be-json' },
      },
    },
    {
      name: 'an access token',
      response: { ...validResponse, accessToken: 'must-not-be-json' },
    },
    {
      name: 'a refresh token',
      response: { ...validResponse, refreshToken: 'must-not-be-json' },
    },
    {
      name: 'roles',
      response: {
        user: { ...validResponse.user, roles: ['CUSTOMER'] },
      },
    },
    {
      name: 'a session identifier',
      response: { ...validResponse, sessionId: 'not-public' },
    },
  ])('rejects a response containing $name', ({ response }) => {
    expect(() => currentUserResponseSchema.parse(response)).toThrow();
  });
});
