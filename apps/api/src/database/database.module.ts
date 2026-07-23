import { Global, Module } from '@nestjs/common';
import { DATABASE_READINESS } from './database-readiness.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: DATABASE_READINESS,
      useExisting: PrismaService,
    },
  ],
  exports: [PrismaService, DATABASE_READINESS],
})
export class DatabaseModule {}
