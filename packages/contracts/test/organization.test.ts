import { describe, expect, it } from 'vitest';
import {
  createOrganizationRequestSchema as create,
  publicOrganizationSchema as publicSchema,
  organizationListResponseSchema as list,
  organizationDetailResponseSchema as detail,
  createOrganizationResponseSchema as response,
  organizationIdParamsSchema,
} from '../src/index.js';

const organization = {
  id: 'de33c359-79fb-482a-9034-00b63d1c9024',
  name: 'Astana Wash',
  description: null,
  createdAt: '2026-09-11T00:00:00.000Z',
  updatedAt: '2026-09-11T00:00:00.000Z',
};
describe('organization contracts', () => {
  it('normalizes NFKC and whitespace while preserving casing', () => {
    expect(
      create.parse({
        name: '  Ａstana\u00a0  Premium Wash  ',
        description: '  Plain <b>text</b>\nSecond line.  ',
      }),
    ).toEqual({ name: 'Astana Premium Wash', description: 'Plain <b>text</b>\nSecond line.' });
  });
  it.each([undefined, null, '', '   ', '\r\n'])(
    'normalizes optional description %#',
    (description) => {
      expect(
        create.parse({ name: 'Wash', ...(description === undefined ? {} : { description }) }),
      ).toEqual({ name: 'Wash', description: null });
    },
  );
  it.each([2, 120])('accepts normalized name length %i', (length) =>
    expect(create.safeParse({ name: ` ${'A'.repeat(length)} ` }).success).toBe(true),
  );
  it.each([undefined, null, 1, '', ' ', 'A', 'A'.repeat(121)])('rejects invalid name %#', (name) =>
    expect(create.safeParse({ name }).success).toBe(false),
  );
  it.each(['\u0000', '\u0001', '\u0009', '\n', '\r', '\u007f', '\u0085'])(
    'rejects name control %# even if normalization would hide it',
    (control) => expect(create.safeParse({ name: `Wash${control}` }).success).toBe(false),
  );
  it.each(['\u0000', '\u0009', '\u000b', '\u007f', '\u0085'])(
    'rejects description control %#',
    (control) =>
      expect(create.safeParse({ name: 'Wash', description: `text${control}` }).success).toBe(false),
  );
  it('preserves CRLF and enforces description length after trimming', () => {
    expect(create.parse({ name: 'Wash', description: ' First\r\nsecond ' }).description).toBe(
      'First\r\nsecond',
    );
    expect(
      create.safeParse({ name: 'Wash', description: ' '.concat('x'.repeat(500), ' ') }).success,
    ).toBe(true);
    expect(create.safeParse({ name: 'Wash', description: 'x'.repeat(501) }).success).toBe(false);
    expect(create.safeParse({ name: 'Wash', description: 4 }).success).toBe(false);
  });
  it.each([
    'unknown',
    'userId',
    'ownerUserId',
    'membershipRole',
    'membershipId',
    'memberships',
    'roles',
    'permissions',
    'password',
    'passwordHash',
    'token',
    'id',
    'createdAt',
    'updatedAt',
  ])('rejects internal/unknown request field %s', (field) =>
    expect(create.safeParse({ name: 'Wash', [field]: 'untrusted' }).success).toBe(false),
  );
  it('accepts strict public detail, creation and list envelopes', () => {
    expect(response.parse({ organization })).toEqual({ organization });
    expect(detail.parse({ organization })).toEqual({ organization });
    expect(list.parse({ organizations: [organization] })).toEqual({
      organizations: [organization],
    });
    expect(list.parse({ organizations: [] })).toEqual({ organizations: [] });
  });
  it.each([
    'userId',
    'ownerUserId',
    'membershipId',
    'membershipRole',
    'memberships',
    'roles',
    'passwordHash',
    'token',
  ])('rejects public internal field %s at all levels', (field) => {
    const value = { ...organization, [field]: 'internal' };
    expect(publicSchema.safeParse(value).success).toBe(false);
    expect(response.safeParse({ organization: value }).success).toBe(false);
    expect(detail.safeParse({ organization: value }).success).toBe(false);
    expect(list.safeParse({ organizations: [value] }).success).toBe(false);
    expect(detail.safeParse({ organization, [field]: 'internal' }).success).toBe(false);
    expect(list.safeParse({ organizations: [], [field]: 'internal' }).success).toBe(false);
  });
  it.each([
    { id: 'not-uuid' },
    { createdAt: 'yesterday' },
    { updatedAt: '2026-09-11' },
    { name: ' Wash ' },
    { name: 'Ｗash' },
    { description: '' },
    { description: ' text ' },
    { description: undefined },
  ])('rejects invalid or noncanonical public values %#', (patch) =>
    expect(publicSchema.safeParse({ ...organization, ...patch }).success).toBe(false),
  );
  it('validates the UUID-only path', () => {
    expect(
      organizationIdParamsSchema.parse({ organizationId: organization.id }).organizationId,
    ).toBe(organization.id);
    for (const value of [
      {},
      { organizationId: 'invalid' },
      { organizationId: organization.id, userId: organization.id },
    ])
      expect(organizationIdParamsSchema.safeParse(value).success).toBe(false);
  });
});
