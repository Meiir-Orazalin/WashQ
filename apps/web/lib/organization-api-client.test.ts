import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOrganization,
  listOwnedOrganizations,
  getOwnedOrganization,
} from './organization-api-client';

const organization = {
  id: 'de33c359-79fb-482a-9034-00b63d1c9024',
  name: 'Wash',
  description: null,
  createdAt: '2026-09-11T00:00:00Z',
  updatedAt: '2026-09-11T00:00:00Z',
};
afterEach(() => vi.unstubAllGlobals());
describe('organization transport', () => {
  it('uses explicit Bearer, omitted credentials/cache, normalized creation and strict list/detail parsing', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ organization }))
      .mockResolvedValueOnce(Response.json({ organizations: [organization] }))
      .mockResolvedValueOnce(Response.json({ organization }));
    vi.stubGlobal('fetch', fetch);
    const abort = new AbortController();
    expect(
      await createOrganization(
        'test-only-token',
        { name: ' Ｗash ', description: ' ' },
        abort.signal,
      ),
    ).toEqual({ organization });
    expect(await listOwnedOrganizations('test-only-token', abort.signal)).toEqual({
      organizations: [organization],
    });
    expect(await getOwnedOrganization('test-only-token', organization.id, abort.signal)).toEqual({
      organization,
    });
    for (const [, options] of fetch.mock.calls)
      expect(options).toMatchObject({
        credentials: 'omit',
        cache: 'no-store',
        signal: abort.signal,
        headers: { Authorization: 'Bearer test-only-token' },
      });
    expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'GET', 'GET']);
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body)).toEqual({ name: 'Wash', description: null });
    expect(fetch.mock.calls[2]?.[0]).toMatch(new RegExp(`/organizations/${organization.id}$`));
    expect(fetch.mock.calls[1]?.[1].body).toBeUndefined();
  });
  it('rejects invalid UUID/input and spoofed ownership before HTTP', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(getOwnedOrganization('test-only-token', '../users')).rejects.toMatchObject({
      status: 400,
    });
    await expect(createOrganization('test-only-token', { name: '' })).rejects.toMatchObject({
      status: 400,
    });
    const input = { name: 'Wash', ownerUserId: 'spoofed' };
    await expect(createOrganization('test-only-token', input)).rejects.toMatchObject({
      status: 400,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([400, 401, 404, 500])(
    'sanitizes %i, preserving only classification without retries',
    async (status) => {
      const code =
        status === 404
          ? 'ORGANIZATION_NOT_FOUND'
          : status === 401
            ? 'AUTHENTICATION_REQUIRED'
            : 'INTERNAL_SERVER_ERROR';
      const fetch = vi.fn().mockResolvedValue(
        Response.json(
          {
            error: { code, message: 'private database detail' },
            timestamp: '2026-09-11T00:00:00Z',
            path: '/api/v1/organizations',
            requestId: 'test',
          },
          { status },
        ),
      );
      vi.stubGlobal('fetch', fetch);
      await expect(getOwnedOrganization('test-only-token', organization.id)).rejects.toMatchObject({
        status,
        code,
        message: 'The organization request failed',
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects private success payloads, invalid JSON and network details', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ organization: { ...organization, membershipId: 'private' } }),
      )
      .mockResolvedValueOnce(
        Response.json({ organizations: [{ ...organization, userId: 'private' }] }),
      )
      .mockResolvedValueOnce(new Response('invalid-json'))
      .mockRejectedValueOnce(new Error('private transport details'));
    vi.stubGlobal('fetch', fetch);
    await expect(createOrganization('test-only-token', { name: 'Wash' })).rejects.toThrow(
      'invalid organization response',
    );
    await expect(listOwnedOrganizations('test-only-token')).rejects.toThrow(
      'invalid organization response',
    );
    await expect(getOwnedOrganization('test-only-token', organization.id)).rejects.toThrow(
      'invalid organization response',
    );
    await expect(listOwnedOrganizations('test-only-token')).rejects.toThrow(
      'could not be completed',
    );
  });
});
