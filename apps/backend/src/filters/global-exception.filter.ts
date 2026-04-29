import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { REQUEST_ID_HEADER } from '../common/constants/request.constants';
import { ErrorCode } from '../common/enums/error-code.enum';
import { ErrorResponse } from '../interfaces/error-response.interface';
import { resolveNodeEnv } from '../lib/config';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = this.getStatus(exception);
    const requestId =
      typeof request.requestId === 'string' ? request.requestId : 'unknown';
    const errorResponse = this.buildErrorResponse(exception, status, requestId);

    response.setHeader(REQUEST_ID_HEADER, requestId);

    if (status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} -> ${status}`,
        stack,
      );
    } else {
      this.logger.warn(
        `[${requestId}] ${request.method} ${request.url} -> ${status} ${errorResponse.code}`,
      );
    }

    response.status(status).json(errorResponse);
  }

  private buildErrorResponse(
    exception: unknown,
    status: number,
    requestId: string,
  ): ErrorResponse {
    const isProduction = resolveNodeEnv() === 'production';

    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();
      const responseBody =
        typeof exceptionResponse === 'object' && exceptionResponse
          ? (exceptionResponse as Record<string, unknown>)
          : undefined;

      return {
        code: this.getErrorCode(status, responseBody),
        message: this.resolveHttpMessage(
          exception,
          responseBody,
          status,
          isProduction,
        ),
        details: this.getErrorDetails(responseBody, status),
        requestId,
      };
    }

    if (exception instanceof Error) {
      return {
        code: ErrorCode.SYS_INTERNAL_ERROR,
        message: isProduction
          ? 'Internal server error'
          : exception.message || 'Internal server error',
        requestId,
      };
    }

    return {
      code: ErrorCode.SYS_INTERNAL_ERROR,
      message: 'Internal server error',
      requestId,
    };
  }

  private getStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveHttpMessage(
    exception: HttpException,
    responseBody: Record<string, unknown> | undefined,
    status: number,
    isProduction: boolean,
  ): string {
    if (status >= 500 && isProduction) {
      return 'Internal server error';
    }

    const explicitMessage = responseBody?.message;

    if (
      typeof explicitMessage === 'string' &&
      explicitMessage.trim().length > 0
    ) {
      return explicitMessage;
    }

    if (Array.isArray(explicitMessage) && explicitMessage.length > 0) {
      return 'Validation failed';
    }

    return exception.message || 'Request failed';
  }

  private getErrorDetails(
    responseBody: Record<string, unknown> | undefined,
    status: number,
  ): ErrorResponse['details'] {
    if (!responseBody) {
      return undefined;
    }

    if ('details' in responseBody) {
      return responseBody.details as ErrorResponse['details'];
    }

    if (status === 400 && Array.isArray(responseBody.message)) {
      return (responseBody.message as string[]).map((message) => ({ message }));
    }

    return undefined;
  }

  private getErrorCode(
    status: number,
    exceptionResponse?: Record<string, unknown>,
  ): string {
    if (
      exceptionResponse &&
      typeof exceptionResponse.code === 'string' &&
      exceptionResponse.code.length > 0
    ) {
      return exceptionResponse.code;
    }

    if (
      exceptionResponse &&
      typeof exceptionResponse.errorCode === 'string' &&
      exceptionResponse.errorCode.length > 0
    ) {
      return exceptionResponse.errorCode;
    }

    switch (status) {
      case 400:
        return exceptionResponse?.details
          ? ErrorCode.SYS_VALIDATION_FAILED
          : ErrorCode.SYS_BAD_REQUEST;
      case 401:
        return ErrorCode.AUTH_UNAUTHORIZED;
      case 403:
        return ErrorCode.SYS_FORBIDDEN;
      case 404:
        return ErrorCode.SYS_NOT_FOUND;
      case 409:
        return ErrorCode.SYS_CONFLICT;
      case 413:
        return ErrorCode.SYS_PAYLOAD_TOO_LARGE;
      case 415:
        return ErrorCode.SYS_UNSUPPORTED_MEDIA_TYPE;
      case 429:
        return ErrorCode.SYS_RATE_LIMIT_EXCEEDED;
      case 503:
        return ErrorCode.SYS_SERVICE_UNAVAILABLE;
      case 504:
        return ErrorCode.SYS_EXTERNAL_SERVICE_TIMEOUT;
      default:
        return ErrorCode.SYS_INTERNAL_ERROR;
    }
  }
}
