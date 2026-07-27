import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from '../src/auth/infrastructure/argon2-password.hasher.js';

describe('Argon2PasswordHasher verification', () => {
  const passwordHasher = new Argon2PasswordHasher();

  it('verifies the correct raw password against its stored hash', async () => {
    const passwordHash = await passwordHasher.hash('example-password');

    await expect(passwordHasher.verify('example-password', passwordHash)).resolves.toBe(true);
  });

  it('rejects an incorrect raw password', async () => {
    const passwordHash = await passwordHasher.hash('example-password');

    await expect(passwordHasher.verify('wrong-password', passwordHash)).resolves.toBe(false);
  });

  it('performs dummy verification using a valid compatible hash', async () => {
    await expect(passwordHasher.verifyDummy('arbitrary-unknown-user-password')).resolves.toBe(
      undefined,
    );
  });
});
