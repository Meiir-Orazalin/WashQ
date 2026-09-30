import type { OpeningHoursEntry } from '@washqueue/contracts';

export interface Branch {
  id: string;
  name: string;
  city: string;
  addressLine: string;
  timeZone: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface WeeklyOpeningHours {
  dayOfWeek: OpeningHoursEntry['dayOfWeek'];
  status: OpeningHoursEntry['status'];
  opensAtMinute: number | null;
  closesAtMinute: number | null;
  closesNextDay: boolean;
}
export interface BranchDetail extends Branch {
  openingHours: WeeklyOpeningHours[];
}
