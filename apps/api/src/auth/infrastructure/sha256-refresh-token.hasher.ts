import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  RefreshTokenHashingError,
  type RefreshTokenHash,
  type RefreshTokenHasher,
} from '../application/refresh-token-hasher.js';

const hashPrefix = 'sha256:';

@Injectable()
export class Sha256RefreshTokenHasher implements RefreshTokenHasher {
  hash(token: string): RefreshTokenHash {
    if (!token) {
      throw new RefreshTokenHashingError();
    }

    const digest = createHash('sha256').update(token, 'utf8').digest('base64url');
    return `${hashPrefix}${digest}` as RefreshTokenHash;
  }

  verify(token: string, tokenHash: RefreshTokenHash): boolean {
    if (!token || !tokenHash.startsWith(hashPrefix)) {
      return false;
    }

    const candidate = Buffer.from(this.hash(token));
    const expected = Buffer.from(tokenHash);

    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }
}
