import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { HealthResponse, ReadinessResponse } from '@washqueue/contracts';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Report API liveness' })
  @ApiOkResponse({ description: 'The API process is running.' })
  health(): HealthResponse {
    return this.healthService.health();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Report API readiness' })
  @ApiOkResponse({ description: 'The API and database are ready.' })
  @ApiServiceUnavailableResponse({ description: 'The database is unavailable.' })
  async readiness(): Promise<ReadinessResponse> {
    const readiness = await this.healthService.readiness();

    if (!readiness) {
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database connection is unavailable',
      });
    }

    return readiness;
  }
}
