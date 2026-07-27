import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import type { PasswordHasher } from '../application/password-hasher.js';

const dummyPasswordHash =
  '$argon2id$v=19$m=19456,t=2,p=1$d2FzaHF1ZXVlLWR1bW15LTE$JTk+rQXRMze73suaieSMu//KrimdluJ7ij7F+R/nUA8';

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hash(password, {
      type: argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  verify(password: string, passwordHash: string): Promise<boolean> {
    return verify(passwordHash, password);
  }

  async verifyDummy(password: string): Promise<void> {
    await verify(dummyPasswordHash, password);
  }
}
