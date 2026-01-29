import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorResponse } from '../interfaces/error-response.interface';
import { ThrottlerException } from '@nestjs/throttler';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const timestamp = new Date().toISOString();

    let errorResponse: ErrorResponse;

    // ============================================
    // HANDLE RATE LIMITING EXCEPTIONS
    // ============================================
    if (exception instanceof ThrottlerException) {
      // Special handling for rate limiting
      errorResponse = {
        statusCode: 429,
        message: 'Too Many Requests. Please try again later.',
        error: 'TooManyRequests',
        timestamp,
        path: request.url,
        details: {
          limit: '3 requests per minute (test configuration)',
          retryAfter: '60 seconds',
          tip: 'Rate limits are configurable via RATE_LIMIT_MAX_REQUESTS in .env'
        }
      };
      
      this.logger.warn(
        `Rate limit exceeded: ${request.ip} -> ${request.url}`
      );
      
      response.status(429).json(errorResponse);
      return;
    }

    if (exception instanceof HttpException) {
      // Handle HTTP exceptions
      const httpException = exception;
      const status = httpException.getStatus();
      const message = httpException.message || 'An error occurred';

      // Get response data from the HttpException
      const exceptionResponse = httpException.getResponse();

      errorResponse = {
        statusCode: status,
        message: Array.isArray(exceptionResponse)
          ? exceptionResponse
          : typeof exceptionResponse === 'object' && exceptionResponse
            ? ((exceptionResponse as Record<string, unknown>)[
                'message'
              ] as string) || message
            : message,
        error: httpException.constructor.name || httpException.name,
        timestamp,
        path: request.url,
      };
    } else if (exception instanceof Error) {
      // Handle general errors
      this.logger.error(
        `Unhandled exception: ${exception.message}`,
        exception.stack,
      );

      errorResponse = {
        statusCode: 500,
        message: exception.message || 'Internal Server Error',
        error: exception.constructor.name || 'Error',
        timestamp,
        path: request.url,
      };
    } else {
      // Handle unknown errors
      this.logger.error(`Unknown exception: ${JSON.stringify(exception)}`);

      errorResponse = {
        statusCode: 500,
        message: 'Internal Server Error',
        error: 'UnknownError',
        timestamp,
        path: request.url,
      };
    }

    // Log the error for debugging
    this.logger.error(
      `Error caught by GlobalExceptionFilter: ${JSON.stringify(errorResponse)}`,
    );

    response.status(errorResponse.statusCode).json(errorResponse);
  }
}