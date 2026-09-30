import { z } from 'zod';

const normalizeText = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
const noControls = (value: string) => !/\p{Cc}/u.test(value);
const textInput = (min: number, max: number) =>
  z
    .string()
    .refine(noControls, 'Control characters are not allowed')
    .transform(normalizeText)
    .pipe(z.string().min(min).max(max));
const publicText = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine(noControls)
    .refine((value) => value === normalizeText(value));
function validTimeZone(value: string) {
  if (!/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(validTimeZone, 'Use a supported IANA time zone, such as Asia/Almaty');
export const createBranchRequestSchema = z.strictObject({
  name: textInput(2, 100),
  city: textInput(2, 100),
  addressLine: textInput(5, 250),
  timeZone: timeZoneSchema,
});
export const branchIdParamsSchema = z.strictObject({
  organizationId: z.uuid(),
  branchId: z.uuid(),
});
export const publicBranchSchema = z.strictObject({
  id: z.uuid(),
  name: publicText(2, 100),
  city: publicText(2, 100),
  addressLine: publicText(5, 250),
  timeZone: z
    .string()
    .min(1)
    .max(100)
    .refine(validTimeZone)
    .refine((value) => value === value.trim()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const weekdays = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;
export const openingHoursStatuses = ['CLOSED', 'OPEN', 'OPEN_24_HOURS'] as const;
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm local time');
export const openingHoursEntrySchema = z
  .strictObject({
    dayOfWeek: z.enum(weekdays),
    status: z.enum(openingHoursStatuses),
    opensAt: timeSchema.nullable(),
    closesAt: timeSchema.nullable(),
    closesNextDay: z.boolean(),
  })
  .superRefine((entry, context) => {
    if (entry.status !== 'OPEN') {
      if (entry.opensAt !== null || entry.closesAt !== null || entry.closesNextDay !== false)
        context.addIssue({
          code: 'custom',
          message: 'Closed and 24-hour days require null times and no next-day flag',
          path: ['status'],
        });
      return;
    }
    if (entry.opensAt === null)
      context.addIssue({ code: 'custom', message: 'Opening time is required', path: ['opensAt'] });
    if (entry.closesAt === null)
      context.addIssue({ code: 'custom', message: 'Closing time is required', path: ['closesAt'] });
    if (entry.opensAt !== null && entry.closesAt !== null) {
      const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
      const duration =
        minute(entry.closesAt) + (entry.closesNextDay ? 1440 : 0) - minute(entry.opensAt);
      if (duration < 1 || duration > 1439)
        context.addIssue({
          code: 'custom',
          message: 'Open intervals must last 1–1439 minutes; use Open 24 hours for a full day',
          path: ['closesAt'],
        });
    }
  });
const completeSchedule = z
  .array(openingHoursEntrySchema)
  .length(7)
  .refine(
    (entries) => new Set(entries.map((entry) => entry.dayOfWeek)).size === 7,
    'Provide every weekday exactly once',
  );
export const replaceOpeningHoursRequestSchema = z.strictObject({
  openingHours: completeSchedule.transform((entries) =>
    [...entries].sort((a, b) => weekdays.indexOf(a.dayOfWeek) - weekdays.indexOf(b.dayOfWeek)),
  ),
});
const canonicalSchedule = completeSchedule.refine(
  (entries) => entries.every((entry, index) => entry.dayOfWeek === weekdays[index]),
  'Weekdays must be in Monday–Sunday order',
);
export const openingHoursResponseSchema = z.strictObject({ openingHours: canonicalSchedule });
export const createBranchResponseSchema = z.strictObject({ branch: publicBranchSchema });
export const branchListResponseSchema = z.strictObject({ branches: z.array(publicBranchSchema) });
export const branchDetailResponseSchema = z.strictObject({
  branch: publicBranchSchema.extend({
    openingHours: z.union([z.array(openingHoursEntrySchema).length(0), canonicalSchedule]),
  }),
});
export type CreateBranchRequest = z.infer<typeof createBranchRequestSchema>;
export type PublicBranch = z.infer<typeof publicBranchSchema>;
export type BranchIdParams = z.infer<typeof branchIdParamsSchema>;
export type OpeningHoursEntry = z.infer<typeof openingHoursEntrySchema>;
export type ReplaceOpeningHoursRequest = z.infer<typeof replaceOpeningHoursRequestSchema>;
export type CreateBranchResponse = z.infer<typeof createBranchResponseSchema>;
export type BranchListResponse = z.infer<typeof branchListResponseSchema>;
export type BranchDetailResponse = z.infer<typeof branchDetailResponseSchema>;
export type OpeningHoursResponse = z.infer<typeof openingHoursResponseSchema>;
