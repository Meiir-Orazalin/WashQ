import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RefreshTokenHash } from '../src/auth/application/refresh-token-hasher.js';
import { RefreshTokenHashingError } from '../src/auth/application/refresh-token-hasher.js';
import { CryptoRefreshTokenGenerator } from '../src/auth/infrastructure/crypto-refresh-token.generator.js';
import { Sha256RefreshTokenHasher } from '../src/auth/infrastructure/sha256-refresh-token.hasher.js';

describe('CryptoRefreshTokenGenerator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates a non-empty token with at least 256 bits of entropy', () => {
    const token = new CryptoRefreshTokenGenerator().generate();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('generates a different value on every repeated call', () => {
    const generator = new CryptoRefreshTokenGenerator();
    const tokens = new Set(Array.from({ length: 64 }, () => generator.generate()));

    expect(tokens.size).toBe(64);
  });

  it('does not log generated token values', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    new CryptoRefreshTokenGenerator().generate();

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('Sha256RefreshTokenHasher', () => {
  const hasher = new Sha256RefreshTokenHasher();
  const rawToken = new CryptoRefreshTokenGenerator().generate();

  it('hashes a raw refresh token without retaining the raw value', () => {
    const tokenHash = hasher.hash(rawToken);

    expect(tokenHash).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).not.toBe(rawToken);
    expect(tokenHash).not.toContain(rawToken);
  });

  it('verifies the valid raw token against its hash', () => {
    expect(hasher.verify(rawToken, hasher.hash(rawToken))).toBe(true);
  });

  it('rejects an invalid raw token', () => {
    expect(hasher.verify('another-token', hasher.hash(rawToken))).toBe(false);
  });

  it('rejects a malformed hash without exposing the raw token', () => {
    const result = hasher.verify(rawToken, 'malformed-hash' as RefreshTokenHash);

    expect(result).toBe(false);
    expect(String(result)).not.toContain(rawToken);
  });

  it('returns a sanitized failure for an empty token', () => {
    expect(() => hasher.hash('')).toThrow(RefreshTokenHashingError);

    try {
      hasher.hash('');
    } catch (error) {
      expect(String(error)).toBe('RefreshTokenHashingError: Refresh token hashing failed');
    }
  });
});
