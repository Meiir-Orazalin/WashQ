import {
  createBranchRequestSchema,
  replaceOpeningHoursRequestSchema,
  weekdays,
  type OpeningHoursEntry,
} from '@washqueue/contracts';

export const emptyBranchForm = { name: '', city: '', addressLine: '', timeZone: '' };
export function validateBranchForm(values: typeof emptyBranchForm) {
  const result = createBranchRequestSchema.safeParse(values);
  const errors: Partial<Record<keyof typeof emptyBranchForm, string>> = {};
  if (!result.success)
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (field === 'name' || field === 'city' || field === 'addressLine' || field === 'timeZone')
        errors[field] ??= issue.message;
    }
  return { result, errors };
}
export function unsavedClosedWeek(): OpeningHoursEntry[] {
  return weekdays.map((dayOfWeek) => ({
    dayOfWeek,
    status: 'CLOSED',
    opensAt: null,
    closesAt: null,
    closesNextDay: false,
  }));
}
export function changeOpeningStatus(
  entry: OpeningHoursEntry,
  status: OpeningHoursEntry['status'],
): OpeningHoursEntry {
  return status === 'OPEN'
    ? {
        ...entry,
        status,
        opensAt: entry.opensAt ?? '09:00',
        closesAt: entry.closesAt ?? '18:00',
        closesNextDay: entry.closesNextDay,
      }
    : { ...entry, status, opensAt: null, closesAt: null, closesNextDay: false };
}
export function validateWeeklyForm(openingHours: OpeningHoursEntry[]) {
  const result = replaceOpeningHoursRequestSchema.safeParse({ openingHours });
  const errors: Record<string, string> = {};
  if (!result.success)
    for (const issue of result.error.issues) {
      const index = issue.path[1];
      const field = issue.path[2];
      const key =
        typeof index === 'number' ? `${weekdays[index]}.${String(field ?? 'status')}` : 'schedule';
      errors[key] ??= issue.message;
    }
  return { result, errors };
}
