import { Inject, Injectable } from '@nestjs/common';
import { serviceName, type HealthResponse, type ReadinessResponse } from '@washqueue/contracts';
import { DATABASE_READINESS, type DatabaseReadiness } from '../database/database-readiness.js';

@Injectable()
export class HealthService {
  constructor(
    @Inject(DATABASE_READINESS)
    private readonly databaseReadiness: DatabaseReadiness,
  ) {}

  health(): HealthResponse {
    return {
      status: 'ok',
      service: serviceName,
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessResponse | null> {
    if (!(await this.databaseReadiness.isReady())) {
      return null;
    }

    return {
      ...this.health(),
      checks: {
        database: 'up',
      },
    };
  }
}
