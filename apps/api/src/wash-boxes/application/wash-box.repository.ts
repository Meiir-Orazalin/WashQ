import type { WashBox } from '../domain/wash-box.js';

export const WASH_BOX_REPOSITORY = Symbol('WASH_BOX_REPOSITORY');
export interface WashBoxRepository {
  create(branchId: string, number: number): Promise<WashBox>;
  listByBranch(branchId: string): Promise<WashBox[]>;
  findByBranchAndId(branchId: string, washBoxId: string): Promise<WashBox | null>;
  setActiveState(branchId: string, washBoxId: string, isActive: boolean): Promise<WashBox | null>;
}
export class WashBoxAlreadyExistsError extends Error {
  constructor() {
    super('The wash box number is already used in this branch');
    this.name = 'WashBoxAlreadyExistsError';
  }
}
export class WashBoxNotFoundError extends Error {
  constructor() {
    super('The wash box was not found');
    this.name = 'WashBoxNotFoundError';
  }
}
