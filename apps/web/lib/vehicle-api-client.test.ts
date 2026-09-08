import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVehicle, listVehicles, updateVehicle, deleteVehicle } from './vehicle-api-client';

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
  it('uses PATCH with only normalized mutable fields and explicit Bearer, then parses a strict response', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ vehicle }));
    vi.stubGlobal('fetch', fetch);
    const abort = new AbortController();
    await expect(
      updateVehicle(
        'test-only-token',
        vehicle.id,
        { plateNumber: '123-abc-01', color: null },
        abort.signal,
      ),
    ).resolves.toEqual({ vehicle });
    expect(fetch.mock.calls[0]?.[0]).toMatch(new RegExp(`/vehicles/${vehicle.id}$`));
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      credentials: 'omit',
      signal: abort.signal,
      headers: { Authorization: 'Bearer test-only-token' },
    });
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({
      plateNumber: '123ABC01',
      color: null,
    });
  });
  it('accepts only DELETE 204 without reading JSON or sending a body', async () => {
    const response = new Response(null, { status: 204 });
    const json = vi.spyOn(response, 'json');
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetch);
    await expect(deleteVehicle('test-only-token', vehicle.id)).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE', credentials: 'omit' });
    expect(fetch.mock.calls[0]?.[1]).not.toHaveProperty('body');
    fetch.mockResolvedValue(Response.json({ vehicle }));
    await expect(deleteVehicle('test-only-token', vehicle.id)).rejects.toThrow(
      'invalid vehicle response',
    );
  });
  it('rejects invalid UUID, empty patch and internal input before transport', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(deleteVehicle('test-only-token', '../auth/logout')).rejects.toMatchObject({
      status: 400,
    });
    await expect(updateVehicle('test-only-token', 'bad-id', { color: null })).rejects.toMatchObject(
      { status: 400 },
    );
    await expect(updateVehicle('test-only-token', vehicle.id, {})).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      updateVehicle('test-only-token', vehicle.id, { color: null, ownerUserId: 'spoofed' } as {
        color: null;
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 404, 409, 500])(
    'classifies mutation %s errors without details or retries',
    async (status) => {
      const code =
        status === 404
          ? 'VEHICLE_NOT_FOUND'
          : status === 409
            ? 'VEHICLE_ALREADY_EXISTS'
            : status === 401
              ? 'AUTHENTICATION_REQUIRED'
              : 'INTERNAL_SERVER_ERROR';
      const fetch = vi.fn().mockImplementation(async () =>
        Response.json(
          {
            error: { code, message: 'private-server-detail' },
            timestamp: '2026-09-07T10:00:00Z',
            path: '/api/v1/vehicles',
            requestId: 'test',
          },
          { status },
        ),
      );
      vi.stubGlobal('fetch', fetch);
      await expect(
        updateVehicle('test-only-token', vehicle.id, { color: null }),
      ).rejects.toMatchObject({ status, code, message: 'The vehicle request failed' });
      await expect(deleteVehicle('test-only-token', vehicle.id)).rejects.toMatchObject({
        status,
        code,
        message: 'The vehicle request failed',
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
  it('rejects private PATCH responses and sanitizes invalid JSON and network failures', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ vehicle: { ...vehicle, ownerUserId: 'private' } }))
      .mockResolvedValueOnce(new Response('bad-json'))
      .mockRejectedValueOnce(new Error('private-network-detail'));
    vi.stubGlobal('fetch', fetch);
    await expect(updateVehicle('test-only-token', vehicle.id, { color: null })).rejects.toThrow(
      'invalid vehicle response',
    );
    await expect(updateVehicle('test-only-token', vehicle.id, { color: null })).rejects.toThrow(
      'invalid vehicle response',
    );
    await expect(deleteVehicle('test-only-token', vehicle.id)).rejects.toThrow(
      'could not be completed',
    );
  });
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
