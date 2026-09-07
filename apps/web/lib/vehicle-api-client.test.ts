import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVehicle, listVehicles } from './vehicle-api-client';

const input = { make: 'Toyota', model: 'Camry', plateNumber: '123 ABC 01' };
const vehicle = {
  ...input,
  id: 'df4e7850-e329-4679-91f1-77b409d93f4f',
  plateNumber: '123ABC01',
  productionYear: null,
  color: null,
  createdAt: '2026-09-07T10:00:00Z',
  updatedAt: '2026-09-07T10:00:00Z',
};
afterEach(() => vi.unstubAllGlobals());

describe('vehicle transport', () => {
  it('uses explicit Bearer, omits cookies, normalizes input and parses public responses', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ vehicle }))
      .mockResolvedValueOnce(Response.json({ vehicles: [vehicle] }));
    vi.stubGlobal('fetch', fetch);
    const abort = new AbortController();
    await expect(createVehicle('test-only-token', input, abort.signal)).resolves.toEqual({
      vehicle,
    });
    await expect(listVehicles('test-only-token', abort.signal)).resolves.toEqual({
      vehicles: [vehicle],
    });
    for (const [, options] of fetch.mock.calls) {
      expect(options).toMatchObject({
        credentials: 'omit',
        cache: 'no-store',
        signal: abort.signal,
        headers: { Authorization: 'Bearer test-only-token' },
      });
    }
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toMatchObject({
      plateNumber: '123ABC01',
      productionYear: null,
      color: null,
    });
  });
  it.each([401, 409, 500])('sanitizes HTTP %s and makes no retries', async (status) => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code:
              status === 401
                ? 'AUTHENTICATION_REQUIRED'
                : status === 409
                  ? 'VEHICLE_ALREADY_EXISTS'
                  : 'INTERNAL_SERVER_ERROR',
            message: 'untrusted-server-detail',
          },
          timestamp: '2026-09-07T10:00:00Z',
          path: '/api/v1/vehicles',
          requestId: 'request-id',
        },
        { status },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(listVehicles('test-only-token')).rejects.toMatchObject({
      message: 'The vehicle request failed',
      status,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects private response fields, invalid JSON, and network details', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ vehicles: [{ ...vehicle, ownerUserId: 'private' }] }))
      .mockResolvedValueOnce(new Response('not-json'))
      .mockRejectedValueOnce(new Error('private-network-detail'));
    vi.stubGlobal('fetch', fetch);
    await expect(listVehicles('test-only-token')).rejects.toThrow('invalid vehicle response');
    await expect(listVehicles('test-only-token')).rejects.toThrow('invalid vehicle response');
    await expect(listVehicles('test-only-token')).rejects.toThrow('could not be completed');
  });
  it('rejects spoofed input before transport', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      createVehicle('test-only-token', { ...input, ownerUserId: 'spoofed' } as typeof input),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
