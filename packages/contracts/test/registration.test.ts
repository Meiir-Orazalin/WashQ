import { describe, expect, it } from 'vitest';
import {
  registrationRequestSchema,
  registrationResponseSchema,
  type RegistrationRequest,
} from '../src/index.js';

const validRegistration = {
  firstName: 'Meiir',
  lastName: 'Orazalin',
  email: 'meiir@example.com',
  password: 'example-password',
} satisfies RegistrationRequest;

describe('registration request contract', () => {
  it('parses a valid registration', () => {
    expect(registrationRequestSchema.parse(validRegistration)).toEqual(validRegistration);
  });

  it('normalizes email casing and surrounding whitespace', () => {
    expect(
      registrationRequestSchema.parse({
        ...validRegistration,
        email: '  Meiir@Example.COM ',
      }).email,
    ).toBe('meiir@example.com');
  });

  it('rejects an invalid email', () => {
    expect(() =>
      registrationRequestSchema.parse({
        ...validRegistration,
        email: 'not-an-email',
      }),
    ).toThrow();
  });

  it('rejects a missing first name', () => {
    const withoutFirstName = {
      lastName: validRegistration.lastName,
      email: validRegistration.email,
      password: validRegistration.password,
    };

    expect(() => registrationRequestSchema.parse(withoutFirstName)).toThrow();
  });

  it('rejects a first name shorter than two characters after trimming', () => {
    expect(() =>
      registrationRequestSchema.parse({
        ...validRegistration,
        firstName: ' M ',
      }),
    ).toThrow();
  });

  it('rejects a password shorter than eight characters', () => {
    expect(() =>
      registrationRequestSchema.parse({
        ...validRegistration,
        password: 'short',
      }),
    ).toThrow();
  });

  it('rejects a password longer than 128 characters', () => {
    expect(() =>
      registrationRequestSchema.parse({
        ...validRegistration,
        password: 'p'.repeat(129),
      }),
    ).toThrow();
  });

  it('accepts an omitted last name', () => {
    const withoutLastName = {
      firstName: validRegistration.firstName,
      email: validRegistration.email,
      password: validRegistration.password,
    };

    expect(registrationRequestSchema.parse(withoutLastName)).not.toHaveProperty('lastName');
  });

  it('normalizes an empty optional last name to null', () => {
    const normalized = registrationRequestSchema.parse({
      ...validRegistration,
      lastName: '   ',
    });

    expect(normalized.lastName).toBeNull();
    expect(registrationRequestSchema.parse(normalized).lastName).toBeNull();
  });

  it('does not trim or otherwise modify the password', () => {
    const password = ' password ';

    expect(
      registrationRequestSchema.parse({
        ...validRegistration,
        password,
      }).password,
    ).toBe(password);
  });
});

describe('registration response contract', () => {
  it('parses the public registration response', () => {
    const response = {
      user: {
        id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
        firstName: 'Meiir',
        lastName: 'Orazalin',
        email: 'meiir@example.com',
        createdAt: '2026-07-27T12:00:00.000Z',
      },
    };

    expect(registrationResponseSchema.parse(response)).toEqual(response);
  });

  it.each([
    {
      name: 'a non-UUID identifier',
      response: {
        user: {
          id: 'not-a-uuid',
          firstName: 'Meiir',
          lastName: null,
          email: 'meiir@example.com',
          createdAt: '2026-07-27T12:00:00.000Z',
        },
      },
    },
    {
      name: 'a non-ISO timestamp',
      response: {
        user: {
          id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
          firstName: 'Meiir',
          lastName: null,
          email: 'meiir@example.com',
          createdAt: 'yesterday',
        },
      },
    },
    {
      name: 'a password hash',
      response: {
        user: {
          id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
          firstName: 'Meiir',
          lastName: null,
          email: 'meiir@example.com',
          createdAt: '2026-07-27T12:00:00.000Z',
          passwordHash: 'secret',
        },
      },
    },
  ])('rejects an invalid registration response containing $name', ({ response }) => {
    expect(() => registrationResponseSchema.parse(response)).toThrow();
  });
});
