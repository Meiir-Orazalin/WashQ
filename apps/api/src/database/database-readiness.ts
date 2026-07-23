export const DATABASE_READINESS = Symbol('DATABASE_READINESS');

export interface DatabaseReadiness {
  isReady(): Promise<boolean>;
}
