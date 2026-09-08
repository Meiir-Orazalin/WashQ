export interface Vehicle {
  id: string;
  make: string;
  model: string;
  plateNumber: string;
  productionYear: number | null;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}
