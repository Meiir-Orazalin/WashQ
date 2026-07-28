import { describe, expect, it, vi } from 'vitest';
import { readBearerToken } from '../src/auth/presentation/bearer-token.reader.js';

describe('readBearerToken', () => {
  it('reads a valid Bearer credential', () => {
    expect(readBearerToken('Bearer signed.access.token')).toBe('signed.access.token');
  });

  it('accepts the Bearer scheme case-insensitively', () => {
    expect(readBearerToken('bEaReR signed.access.token')).toBe('signed.access.token');
  });

  it('trims only transport-level surrounding whitespace', () => {
    expect(readBearerToken('  Bearer signed.access.token  ')).toBe('signed.access.token');
  });

  it.each([
    { name: 'a missing header', header: undefined },
    { name: 'an empty token', header: 'Bearer   ' },
    { name: 'an unsupported scheme', header: 'Basic signed.access.token' },
    { name: 'a malformed credential', header: 'Bearer token extra' },
    { name: 'multiple comma-separated credentials', header: 'Bearer one,Bearer two' },
    { name: 'multiple header values', header: ['Bearer one', 'Bearer two'] },
  ])('rejects $name', ({ header }) => {
    expect(readBearerToken(header)).toBeUndefined();
  });

  it('does not log or include the token in an error', () => {
    const token = 'must-not-be-logged.access.token';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(readBearerToken(`Bearer ${token},Bearer another`)).toBeUndefined();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });
});
