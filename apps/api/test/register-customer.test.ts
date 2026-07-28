import type { RegistrationRequest } from '@washqueue/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PasswordHasher } from '../src/auth/application/password-hasher.js';
import { RegisterCustomerUseCase } from '../src/auth/application/register-customer.use-case.js';
import { mapRegistrationResponse } from '../src/auth/presentation/registration-response.mapper.js';
import {
  DuplicateUserEmailError,
  type RegisteredUser,
  type UserRepository,
} from '../src/users/application/user-repository.js';

const registration: RegistrationRequest = {
  firstName: 'Meiir',
  lastName: 'Orazalin',
  email: 'meiir@example.com',
  password: 'example-password',
};

const registeredUser: RegisteredUser = {
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  firstName: 'Meiir',
  lastName: 'Orazalin',
  email: 'meiir@example.com',
  createdAt: new Date('2026-07-27T12:00:00.000Z'),
};

describe('RegisterCustomerUseCase', () => {
  let passwordHasher: PasswordHasher;
  let userRepository: UserRepository;
  let registerCustomer: RegisterCustomerUseCase;
  const hash = vi.fn<PasswordHasher['hash']>();
  const verify = vi.fn<PasswordHasher['verify']>();
  const verifyDummy = vi.fn<PasswordHasher['verifyDummy']>();
  const create = vi.fn<UserRepository['create']>();
  const findAuthenticationByEmail = vi.fn<UserRepository['findAuthenticationByEmail']>();
  const findPublicById = vi.fn<UserRepository['findPublicById']>();

  beforeEach(() => {
    hash.mockReset().mockResolvedValue('stored-password-hash');
    verify.mockReset();
    verifyDummy.mockReset();
    create.mockReset().mockResolvedValue(registeredUser);
    findAuthenticationByEmail.mockReset();
    findPublicById.mockReset();
    passwordHasher = { hash, verify, verifyDummy };
    userRepository = { create, findAuthenticationByEmail, findPublicById };
    registerCustomer = new RegisterCustomerUseCase(passwordHasher, userRepository);
  });

  it('registers a customer successfully', async () => {
    await expect(registerCustomer.execute(registration)).resolves.toEqual(registeredUser);
  });

  it('trims names and normalizes the email before persistence', async () => {
    await registerCustomer.execute({
      ...registration,
      firstName: '  Meiir ',
      lastName: ' Orazalin  ',
      email: ' Meiir@Example.COM ',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Meiir',
        lastName: 'Orazalin',
        email: 'meiir@example.com',
      }),
    );
  });

  it('persists an empty optional last name as null', async () => {
    await registerCustomer.execute({
      ...registration,
      lastName: '  ',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ lastName: null }));
  });

  it('passes the raw password unchanged to the hasher', async () => {
    const password = ' password with spaces ';

    await registerCustomer.execute({
      ...registration,
      password,
    });

    expect(hash).toHaveBeenCalledWith(password);
  });

  it('passes only the password hash to persistence', async () => {
    await registerCustomer.execute(registration);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: 'stored-password-hash' }),
    );
    expect(JSON.stringify(create.mock.calls)).not.toContain(registration.password);
  });

  it('does not persist after a hashing failure', async () => {
    hash.mockRejectedValueOnce(new Error('hashing failed'));

    await expect(registerCustomer.execute(registration)).rejects.toThrow('hashing failed');
    expect(create).not.toHaveBeenCalled();
  });

  it('returns the controlled duplicate-email application error', async () => {
    create.mockRejectedValueOnce(new DuplicateUserEmailError());

    await expect(registerCustomer.execute(registration)).rejects.toBeInstanceOf(
      DuplicateUserEmailError,
    );
  });

  it('maps a response without password information', () => {
    const response = mapRegistrationResponse(registeredUser);

    expect(response).toEqual({
      user: {
        id: registeredUser.id,
        firstName: registeredUser.firstName,
        lastName: registeredUser.lastName,
        email: registeredUser.email,
        createdAt: registeredUser.createdAt.toISOString(),
      },
    });
    expect(response.user).not.toHaveProperty('password');
    expect(response.user).not.toHaveProperty('passwordHash');
  });
});
