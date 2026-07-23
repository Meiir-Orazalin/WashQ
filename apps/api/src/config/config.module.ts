import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { applicationConfiguration } from './application.config.js';
import { validateEnvironment } from './environment.js';

@Module({
  imports: [
    NestConfigModule.forRoot({
      cache: true,
      envFilePath: ['../../.env', '.env'],
      isGlobal: true,
      load: [applicationConfiguration],
      validate: validateEnvironment,
    }),
  ],
})
export class ConfigModule {}
