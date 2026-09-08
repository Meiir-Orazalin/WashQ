import { describe, expect, it } from 'vitest';
import {
  currentUserResponseSchema,
  registrationRequestSchema,
  updateCurrentUserProfileRequestSchema as schema,
} from '../src/index.js';

describe('profile partial update contract', () => {
  it.each([
    [{ firstName: '  Meiir ' }, { firstName: 'Meiir' }],
    [{ lastName: '  Orazalin ' }, { lastName: 'Orazalin' }],
    [
      { firstName: ' Meiir ', lastName: ' Orazalin ' },
      { firstName: 'Meiir', lastName: 'Orazalin' },
    ],
    [{ lastName: null }, { lastName: null }],
    [{ lastName: ' \t ' }, { lastName: null }],
    [{ lastName: '' }, { lastName: null }],
  ])('normalizes partial names and preserves clear semantics %#', (input, expected) => {
    expect(schema.parse(input)).toEqual(expected);
  });

  it('reuses registration exactly, including preserved internal whitespace and casing', () => {
    const names = { firstName: ' Mei  Ir ', lastName: ' Ora  Zalin ' };
    const registration = registrationRequestSchema.parse({
      ...names,
      email: 'test@example.invalid',
      password: 'test-only-password',
    });
    expect(schema.parse(names)).toEqual({
      firstName: registration.firstName,
      lastName: registration.lastName,
    });
    expect(schema.parse(names).firstName).toBe('Mei  Ir');
  });

  it.each([
    {},
    { firstName: undefined },
    { lastName: undefined },
    { firstName: null },
    { firstName: '' },
    { firstName: ' ' },
    { firstName: 'A' },
    { firstName: 'A'.repeat(61) },
    { lastName: 'A' },
    { lastName: 'A'.repeat(61) },
    { firstName: 123 },
    { lastName: false },
  ])('rejects invalid/empty input %#', (input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it.each(['firstName', 'lastName'] as const)('accepts exact normalized limits for %s', (field) => {
    for (const length of [2, 60])
      expect(schema.safeParse({ [field]: ` ${'A'.repeat(length)} ` }).success).toBe(true);
  });

  it.each([
    'extra',
    'id',
    'userId',
    'ownerUserId',
    'email',
    'password',
    'passwordHash',
    'role',
    'roles',
    'permission',
    'permissions',
    'organizationId',
    'organizationMemberships',
    'token',
    'accessToken',
    'refreshToken',
    'sessions',
    'sessionId',
    'createdAt',
    'updatedAt',
  ])('rejects the non-mutable field %s', (field) => {
    expect(schema.safeParse({ firstName: 'Valid', [field]: 'not-allowed' }).success).toBe(false);
  });

  const user = {
    id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
    firstName: 'Meiir',
    lastName: null,
    email: 'meiir@example.com',
  };
  it('reuses the existing strict public current-user response', () => {
    expect(currentUserResponseSchema.parse({ user })).toEqual({ user });
    expect(currentUserResponseSchema.safeParse({ user, extra: true }).success).toBe(false);
  });
  it.each([
    'passwordHash',
    'password',
    'sessions',
    'accessToken',
    'refreshToken',
    'createdAt',
    'updatedAt',
    'roles',
    'ownerUserId',
  ])('rejects internal response field %s', (field) => {
    expect(
      currentUserResponseSchema.safeParse({ user: { ...user, [field]: 'internal' } }).success,
    ).toBe(false);
  });
});
