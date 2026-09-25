import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiErrorDto } from '../dto/response-envelope.dto';

/**
 * Global exception filter to standardize error responses.
 *
 * Catches all HttpException instances and returns a consistent error envelope:
 * { success: false, error: { message, statusCode, code?, details? } }
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    let message = 'An error occurred';
    let code: string | undefined;
    let details: Record<string, unknown> | undefined;

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (typeof exceptionResponse === 'object') {
      const responseObj = exceptionResponse as Record<string, unknown>;
      message = (responseObj.message as string) || message;
      
      // Handle validation errors
      if (Array.isArray(responseObj.message)) {
        message = responseObj.message.join(', ');
        details = { validationErrors: responseObj.message };
      }

      // Extract error code if present
      if (responseObj.error) {
        code = responseObj.error as string;
      }

      // Include any additional fields as details
      Object.keys(responseObj).forEach((key) => {
        if (key !== 'message' && key !== 'error' && key !== 'statusCode') {
          details = details || {};
          details[key] = responseObj[key];
        }
      });
    }

    const errorResponse: {
      success: false;
      error: ApiErrorDto;
    } = {
      success: false,
      error: {
        message,
        statusCode: status,
        ...(code && { code }),
        ...(details && { details }),
      },
    };

    this.logger.error(
      `${request.method} ${request.url} - ${status} - ${message}`,
      exception.stack,
    );

    response.status(status).json(errorResponse);
  }
}
