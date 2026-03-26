import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorResponse } from '../interfaces/error-response.interface';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const timestamp = new Date().toISOString();

    let errorResponse: ErrorResponse;

    if (exception instanceof HttpException) {
      // Handle HTTP exceptions
      const httpException = exception;
      const status = httpException.getStatus();
      const exceptionResponse = httpException.getResponse();

      // Handle BadRequestException with validation errors
      if (
        status === 400 &&
        typeof exceptionResponse === 'object' &&
        exceptionResponse
      ) {
        const response = exceptionResponse as Record<string, unknown>;

        // Check if this is a validation error response from our CustomValidationPipe
        if (response.error === 'Validation Failed') {
          const message: string | string[] =
            (response.message as string | string[]) || 'Validation failed';
          errorResponse = {
            statusCode: status,
            message,
            error: 'ValidationError',
            timestamp,
            path: request.url,
          };
        } else {
          // Standard HTTP exception
          const msg: string | string[] =
            response['message']?.toString() ||
            httpException.message ||
            'Bad Request';
          errorResponse = {
            statusCode: status,
            message: msg,
            error: httpException.constructor.name || httpException.name,
            timestamp,
            path: request.url,
          };
        }
      } else {
        // Other HTTP exceptions
        const message = httpException.message || 'An error occurred';
        let msg: string | string[] = message;

        if (Array.isArray(exceptionResponse) && exceptionResponse.length > 0) {
          msg = exceptionResponse;
        } else if (typeof exceptionResponse === 'object' && exceptionResponse) {
          const msgFromResponse = (
            exceptionResponse as Record<string, unknown>
          )['message'] as string | undefined;
          msg = msgFromResponse || message;
        }

        errorResponse = {
          statusCode: status,
          message: msg,
          error: httpException.constructor.name || httpException.name,
          timestamp,
          path: request.url,
        };
      }
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
