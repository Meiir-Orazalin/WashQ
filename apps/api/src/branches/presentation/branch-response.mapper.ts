import { openingHoursEntrySchema, publicBranchSchema, weekdays } from '@washqueue/contracts';
import type { Branch, WeeklyOpeningHours } from '../domain/branch.js';

export function mapBranchResponse(branch: Branch) {
  return publicBranchSchema.parse({
    id: branch.id,
    name: branch.name,
    city: branch.city,
    addressLine: branch.addressLine,
    timeZone: branch.timeZone,
    createdAt: branch.createdAt.toISOString(),
    updatedAt: branch.updatedAt.toISOString(),
  });
}
export function mapOpeningHoursResponse(entries: WeeklyOpeningHours[]) {
  const time = (minute: number | null) =>
    minute === null
      ? null
      : `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return [...entries]
    .sort((a, b) => weekdays.indexOf(a.dayOfWeek) - weekdays.indexOf(b.dayOfWeek))
    .map((entry) =>
      openingHoursEntrySchema.parse({
        dayOfWeek: entry.dayOfWeek,
        status: entry.status,
        opensAt: time(entry.opensAtMinute),
        closesAt: time(entry.closesAtMinute),
        closesNextDay: entry.closesNextDay,
      }),
    );
}
