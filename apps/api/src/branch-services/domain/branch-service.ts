export interface BranchService {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMinor: number;
  currency: 'KZT';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
