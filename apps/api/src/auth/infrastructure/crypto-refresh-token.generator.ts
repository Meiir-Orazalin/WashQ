import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { RefreshTokenGenerator } from '../application/refresh-token-generator.js';

const refreshTokenEntropyBytes = 32;

@Injectable()
export class CryptoRefreshTokenGenerator implements RefreshTokenGenerator {
  generate(): string {
    return randomBytes(refreshTokenEntropyBytes).toString('base64url');
  }
}
