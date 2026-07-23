import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './http/http-exception.filter.js';
import { requestIdMiddleware } from './http/request-id.middleware.js';
import { ZodValidationPipe } from './http/zod-validation.pipe.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const isProduction = config.getOrThrow<string>('application.nodeEnv') === 'production';

  app.useLogger(
    new ConsoleLogger({
      json: isProduction,
      logLevels: logLevelsFor(config.getOrThrow<LogLevel>('application.logLevel')),
    }),
  );
  app.flushLogs();

  const expressApplication = app.getHttpAdapter().getInstance() as {
    disable(setting: string): void;
  };
  expressApplication.disable('x-powered-by');
  app.use(helmet());
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: false, limit: '1mb' }));
  app.use(requestIdMiddleware);
  app.enableCors({
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: config.getOrThrow<string[]>('application.corsOrigins'),
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  if (config.getOrThrow<boolean>('application.docsEnabled')) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('WashQueue KZ API')
        .setDescription('REST API foundation for WashQueue KZ')
        .setVersion('0.0.0')
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.getOrThrow<number>('application.port'), '0.0.0.0');
}

function logLevelsFor(configuredLevel: LogLevel): LogLevel[] {
  const levels: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
  const configuredIndex = levels.indexOf(configuredLevel);

  return configuredIndex === -1
    ? ['fatal', 'error', 'warn', 'log']
    : levels.slice(0, configuredIndex + 1);
}

void bootstrap();
