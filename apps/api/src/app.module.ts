import { Module } from '@nestjs/common';
import { BranchServicesModule } from './branch-services/branch-services.module.js';
import { WashBoxesModule } from './wash-boxes/wash-boxes.module.js';
import { BranchesModule } from './branches/branches.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { VehiclesModule } from './vehicles/vehicles.module.js';
import { UsersHttpModule } from './users/users-http.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    VehiclesModule,
    UsersHttpModule,
    OrganizationsModule,
    BranchesModule,
    WashBoxesModule,
    BranchServicesModule,
  ],
})
export class AppModule {}
