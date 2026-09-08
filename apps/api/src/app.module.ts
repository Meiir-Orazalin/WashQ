import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { VehiclesModule } from './vehicles/vehicles.module.js';
import { UsersHttpModule } from './users/users-http.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    VehiclesModule,
    UsersHttpModule,
  ],
})
export class AppModule {}
