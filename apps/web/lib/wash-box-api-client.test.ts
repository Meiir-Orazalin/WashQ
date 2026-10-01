import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWashBox,
  listWashBoxes,
  getWashBox,
  setWashBoxActiveState,
} from './wash-box-api-client';
import { ApiClientError } from './api-client';
const org = '00000000-0000-4000-8000-000000000001';
const branch = '00000000-0000-4000-8000-000000000002';
const id = '00000000-0000-4000-8000-000000000003';
const box = {
  id,
  number: 1,
  isActive: true,
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
};
afterEach(() => vi.unstubAllGlobals());
describe('wash box credential-omitting explicit transport', () => {
  it('uses exact routes/methods, explicit bearer and no ownership bodies', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ washBox: box }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ washBoxes: [box] }))
      .mockResolvedValueOnce(Response.json({ washBox: box }))
      .mockResolvedValueOnce(Response.json({ washBox: { ...box, isActive: false } }));
    vi.stubGlobal('fetch', fetchMock);
    await createWashBox('test-only-token', org, branch, { number: 1 });
    await listWashBoxes('test-only-token', org, branch);
    await getWashBox('test-only-token', org, branch, id);
    await setWashBoxActiveState('test-only-token', org, branch, id, { isActive: false });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [index, method] of ['POST', 'GET', 'GET', 'PATCH'].entries()) {
      const [url, options] = fetchMock.mock.calls[index] ?? [];
      expect(url).toContain(
        `/organizations/${org}/branches/${branch}/wash-boxes${index >= 2 ? '/' + id : ''}`,
      );
      expect(options).toMatchObject({
        method,
        credentials: 'omit',
        cache: 'no-store',
        headers: { Authorization: 'Bearer test-only-token' },
      });
    }
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({ number: 1 });
    expect(JSON.parse(fetchMock.mock.calls[3]?.[1].body)).toEqual({ isActive: false });
  });
  it('rejects invalid IDs/inputs before transport and never coerces', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(listWashBoxes('test', org, 'invalid')).rejects.toBeInstanceOf(ApiClientError);
    await expect(createWashBox('test', org, branch, { number: 0 })).rejects.toBeInstanceOf(
      ApiClientError,
    );
    await expect(getWashBox('test', org, branch, 'invalid')).rejects.toBeInstanceOf(ApiClientError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects public ownership fields and sanitizes network/JSON failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ washBox: { ...box, branchId: branch } }))
      .mockRejectedValueOnce(new Error('private transport'))
      .mockResolvedValueOnce(new Response('invalid'));
    vi.stubGlobal('fetch', fetchMock);
    for (let index = 0; index < 3; index++)
      await expect(getWashBox('test', org, branch, id)).rejects.toBeInstanceOf(ApiClientError);
  });
  it.each([401, 404, 409, 500])(
    'safe %s classification has no retry or raw error message',
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json(
          {
            error: { code: 'SAFE_CODE', message: 'private database detail' },
            path: '/safe',
            timestamp: new Date().toISOString(),
            requestId: 'request',
          },
          { status },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(listWashBoxes('test', org, branch)).rejects.toMatchObject({
        status,
        code: 'SAFE_CODE',
        message: 'The wash box request failed',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it('an aborted prior-branch 401 cannot be classified as current authentication failure', async () => {
    const abort = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        abort.abort();
        return Response.json(
          {
            error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required' },
            path: '/safe',
            timestamp: new Date().toISOString(),
            requestId: 'request',
          },
          { status: 401 },
        );
      }),
    );
    await expect(listWashBoxes('test', org, branch, abort.signal)).rejects.toMatchObject({
      status: undefined,
      code: undefined,
    });
  });
});
