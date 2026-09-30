import { afterEach, describe, expect, it, vi } from 'vitest';
import { weekdays } from '@washqueue/contracts';
import {
  createBranch,
  listOwnedBranches,
  getOwnedBranch,
  replaceOpeningHours,
} from './branch-api-client';
const org = '00000000-0000-4000-8000-000000000001';
const id = '00000000-0000-4000-8000-000000000002';
const input = {
  name: 'Branch',
  city: 'Astana',
  addressLine: 'Address 12',
  timeZone: 'Asia/Almaty',
};
const branch = {
  ...input,
  id,
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
};
const hours = {
  openingHours: weekdays.map((dayOfWeek) => ({
    dayOfWeek,
    status: 'CLOSED' as const,
    opensAt: null,
    closesAt: null,
    closesNextDay: false,
  })),
};
afterEach(() => vi.unstubAllGlobals());
describe('explicit Bearer branch transport', () => {
  for (const method of ['create', 'list', 'detail', 'replace'])
    it(`${method} uses correct method, omit credentials, safe public body and strict response`, async () => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(
              method === 'list'
                ? { branches: [branch] }
                : method === 'detail'
                  ? { branch: { ...branch, openingHours: [] } }
                  : method === 'replace'
                    ? hours
                    : { branch },
            ),
            { status: method === 'create' ? 201 : 200 },
          ),
        );
      vi.stubGlobal('fetch', fetch);
      const abort = new AbortController();
      if (method === 'create') await createBranch('test-only-token', org, input, abort.signal);
      if (method === 'list') await listOwnedBranches('test-only-token', org, abort.signal);
      if (method === 'detail') await getOwnedBranch('test-only-token', org, id, abort.signal);
      if (method === 'replace')
        await replaceOpeningHours('test-only-token', org, id, hours, abort.signal);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, options] = fetch.mock.calls[0] ?? [];
      expect(url).toContain(`/organizations/${org}/branches`);
      expect(options).toMatchObject({
        credentials: 'omit',
        cache: 'no-store',
        method: method === 'create' ? 'POST' : method === 'replace' ? 'PUT' : 'GET',
        signal: abort.signal,
      });
      if (method === 'list' || method === 'detail') expect(options.body).toBeUndefined();
      expect(JSON.stringify(options.body ?? null)).not.toMatch(
        /token|userId|organizationId|membership/,
      );
    });
  it('rejects invalid IDs/input before fetch', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(getOwnedBranch('test-only-token', '../unsafe', id)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      createBranch('test-only-token', org, { ...input, timeZone: '+05:00' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      replaceOpeningHours('test-only-token', org, id, { openingHours: [] }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not repair invalid public responses or parse ownership internals', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ branch: { ...branch, organizationId: org } })),
        ),
    );
    await expect(createBranch('test-only-token', org, input)).rejects.toThrow(
      'Invalid branch response',
    );
  });
  it('classifies 401/404/500 safely without retry or database message reflection', async () => {
    for (const status of [401, 404, 500]) {
      const fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: status === 404 ? 'BRANCH_NOT_FOUND' : 'AUTHENTICATION_REQUIRED',
              message: 'private constraint',
            },
            timestamp: branch.createdAt,
            path: '/safe',
            requestId: 'request',
          }),
          { status },
        ),
      );
      vi.stubGlobal('fetch', fetch);
      await expect(getOwnedBranch('test-only-token', org, id)).rejects.toMatchObject({
        status,
        message: 'The branch request failed',
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});
