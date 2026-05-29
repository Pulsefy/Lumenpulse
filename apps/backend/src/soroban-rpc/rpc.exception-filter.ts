import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { RpcError, RPC_ERROR_HTTP_STATUS } from './rpc.errors';


@Catch(RpcError)
export class RpcExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(RpcExceptionFilter.name);

  catch(exception: RpcError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status =
      RPC_ERROR_HTTP_STATUS[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;

    this.logger.error(
      JSON.stringify({
        event: 'rpc.exception.filter',
        code: exception.code,
        message: exception.message,
        httpStatus: status,
      }),
    );

    response.status(status).json({
      success: false,
      ...exception.toApiError(),
    });
  }
}