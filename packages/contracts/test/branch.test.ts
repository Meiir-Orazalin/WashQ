import { describe, expect, it } from 'vitest';
import {
  branchDetailResponseSchema,
  branchListResponseSchema,
  createBranchRequestSchema,
  createBranchResponseSchema,
  openingHoursEntrySchema,
  openingHoursResponseSchema,
  replaceOpeningHoursRequestSchema,
  weekdays,
  branchIdParamsSchema,
} from '../src/index.js';
const input = {
  name: 'Saryarka Branch',
  city: 'Astana',
  addressLine: '12 Saryarka Avenue',
  timeZone: 'Asia/Almaty',
};
const branch = {
  ...input,
  id: '00000000-0000-4000-8000-000000000001',
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
};
const closed = {
  dayOfWeek: 'MONDAY',
  status: 'CLOSED',
  opensAt: null,
  closesAt: null,
  closesNextDay: false,
};
const week = weekdays.map((dayOfWeek) => ({ ...closed, dayOfWeek }));
describe('branch contracts', () => {
  it('normalizes NFKC, whitespace, punctuation and IANA trim without changing casing', () => {
    expect(
      createBranchRequestSchema.parse({
        ...input,
        name: ' Ｓaryarka   Branch ',
        city: ' Ａstana ',
        addressLine: ' 12  Saryarka Avenue ',
        timeZone: ' Asia/Almaty ',
      }),
    ).toEqual(input);
  });
  for (const [field, min, max] of [
    ['name', 2, 100],
    ['city', 2, 100],
    ['addressLine', 5, 250],
  ] as const)
    for (const length of [0, min - 1, min, max, max + 1])
      it(`${field} length ${length}`, () => {
        expect(
          createBranchRequestSchema.safeParse({ ...input, [field]: 'x'.repeat(length) }).success,
        ).toBe(length >= min && length <= max);
      });
  for (const field of ['name', 'city', 'addressLine'])
    for (const character of ['\n', '\t', '\u0000', '\u007f'])
      it(`rejects control ${character.charCodeAt(0)} in ${field}`, () =>
        expect(
          createBranchRequestSchema.safeParse({ ...input, [field]: `Valid${character}text` })
            .success,
        ).toBe(false));
  for (const zone of ['UTC', 'Asia/Almaty', 'Asia/Dubai', 'Europe/London'])
    it(`valid zone ${zone}`, () =>
      expect(createBranchRequestSchema.safeParse({ ...input, timeZone: zone }).success).toBe(true));
  for (const zone of ['+05:00', '-0500', 'Not/AZone', '', 'x'.repeat(101), 'Asia/Almaty\u0000'])
    it(`rejects unsupported zone ${zone.length}`, () =>
      expect(createBranchRequestSchema.safeParse({ ...input, timeZone: zone }).success).toBe(
        false,
      ));
  for (const field of [
    'organizationId',
    'ownerUserId',
    'userId',
    'membershipId',
    'membershipRole',
    'token',
    'password',
    'id',
    'opensAtMinute',
  ])
    it(`rejects ${field} in requests and public output`, () => {
      expect(createBranchRequestSchema.safeParse({ ...input, [field]: 'private' }).success).toBe(
        false,
      );
      expect(
        createBranchResponseSchema.safeParse({ branch: { ...branch, [field]: 'private' } }).success,
      ).toBe(false);
    });
  it('strictly parses envelopes, UUIDs, timestamps and unconfigured detail', () => {
    expect(createBranchResponseSchema.parse({ branch })).toEqual({ branch });
    expect(branchListResponseSchema.parse({ branches: [branch] })).toEqual({ branches: [branch] });
    expect(
      branchDetailResponseSchema.parse({ branch: { ...branch, openingHours: [] } }).branch
        .openingHours,
    ).toEqual([]);
    expect(
      branchDetailResponseSchema.safeParse({ branch: { ...branch, openingHours: [closed] } })
        .success,
    ).toBe(false);
    expect(
      branchIdParamsSchema.safeParse({ organizationId: branch.id, branchId: 'bad' }).success,
    ).toBe(false);
    expect(
      createBranchResponseSchema.safeParse({ branch: { ...branch, timeZone: ' UTC ' } }).success,
    ).toBe(false);
  });
});
describe('complete local weekly schedule', () => {
  for (const dayOfWeek of weekdays)
    for (const status of ['CLOSED', 'OPEN_24_HOURS', 'OPEN'] as const)
      it(`${dayOfWeek} ${status}`, () =>
        expect(
          openingHoursEntrySchema.safeParse(
            status === 'OPEN'
              ? { ...closed, dayOfWeek, status, opensAt: '00:00', closesAt: '23:59' }
              : { ...closed, dayOfWeek, status },
          ).success,
        ).toBe(true));
  for (const time of ['24:00', '12:60', '9:00', '09:0', '-1:00', '09:00:00'])
    it(`invalid time ${time}`, () =>
      expect(
        openingHoursEntrySchema.safeParse({
          ...closed,
          status: 'OPEN',
          opensAt: time,
          closesAt: '20:00',
        }).success,
      ).toBe(false));
  for (const [opensAt, closesAt, closesNextDay, valid] of [
    ['22:00', '02:00', true, true],
    ['00:00', '23:59', false, true],
    ['23:59', '00:00', true, true],
    ['09:00', '09:00', false, false],
    ['09:00', '09:00', true, false],
    ['09:00', '20:00', true, false],
    ['20:00', '09:00', false, false],
  ] as const)
    it(`interval ${opensAt} ${closesAt} ${closesNextDay}`, () =>
      expect(
        openingHoursEntrySchema.safeParse({
          ...closed,
          status: 'OPEN',
          opensAt,
          closesAt,
          closesNextDay,
        }).success,
      ).toBe(valid));
  for (const status of ['CLOSED', 'OPEN_24_HOURS'])
    for (const patch of [{ opensAt: '09:00' }, { closesAt: '20:00' }, { closesNextDay: true }])
      it(`rejects incompatible ${status} fields`, () =>
        expect(openingHoursEntrySchema.safeParse({ ...closed, status, ...patch }).success).toBe(
          false,
        ));
  it('requires explicit OPEN times and boolean, rejects public internals', () => {
    for (const patch of [
      { opensAt: null },
      { closesAt: null },
      { closesNextDay: undefined },
      { id: branch.id },
      { opensAtMinute: 540 },
      { branchId: branch.id },
    ])
      expect(
        openingHoursEntrySchema.safeParse({
          ...closed,
          status: 'OPEN',
          opensAt: '09:00',
          closesAt: '20:00',
          ...patch,
        }).success,
      ).toBe(false);
  });
  it('accepts arbitrary request order and produces canonical order, while strict responses reject disorder', () => {
    expect(
      replaceOpeningHoursRequestSchema.parse({ openingHours: [...week].reverse() }).openingHours,
    ).toEqual(week);
    expect(
      openingHoursResponseSchema.safeParse({ openingHours: [...week].reverse() }).success,
    ).toBe(false);
    expect(openingHoursResponseSchema.parse({ openingHours: week }).openingHours).toEqual(week);
  });
  for (const entries of [[], week.slice(1), [...week, closed], [...week.slice(0, 6), closed]])
    it(`rejects missing/duplicate schedule ${entries.length}`, () =>
      expect(replaceOpeningHoursRequestSchema.safeParse({ openingHours: entries }).success).toBe(
        false,
      ));
  it('rejects unknown schedule and response fields', () => {
    expect(
      replaceOpeningHoursRequestSchema.safeParse({ openingHours: week, organizationId: branch.id })
        .success,
    ).toBe(false);
    expect(
      openingHoursResponseSchema.safeParse({ openingHours: week, userId: branch.id }).success,
    ).toBe(false);
  });
});
