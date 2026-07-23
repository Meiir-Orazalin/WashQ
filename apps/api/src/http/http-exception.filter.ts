import { randomUUID } from 'node:crypto';
import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorResponse } from '@washqueue/contracts';
import type { RequestWithId } from './request-id.middleware.js';

interface SafeExceptionBody {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithId>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const safeBody = this.getSafeBody(exception, status);
    const requestId = request.requestId || randomUUID();

    if (status >= 500) {
      this.logger.error({
        event: 'request_failed',
        exceptionType: exception instanceof Error ? exception.name : 'UnknownError',
        method: request.method,
        path: request.originalUrl,
        requestId,
        status,
      });
    }

    const body: ApiErrorResponse = {
      error: safeBody,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
      requestId,
    };

    response.status(status).json(body);
  }

  private getSafeBody(exception: unknown, status: number): ApiErrorResponse['error'] {
    if (!(exception instanceof HttpException)) {
      return {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      };
    }

    const response = exception.getResponse();
    if (typeof response === 'string') {
      return {
        code: `HTTP_${status}`,
        message: response,
      };
    }

    const body = response as SafeExceptionBody;
    const message = Array.isArray(body.message)
      ? 'Request validation failed'
      : typeof body.message === 'string'
        ? body.message
        : exception.message;

    return {
      code: typeof body.code === 'string' ? body.code : `HTTP_${status}`,
      message,
      ...(body.details === undefined ? {} : { details: body.details }),
    };
  }
}
