import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Decorator to extract the request ID from the current request.
 * Usage: @RequestId() requestId: string
 */
export const RequestId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (request as any).requestId || 'unknown';
  },
);

/**
 * Decorator to extract the full request object with request ID.
 * Usage: @RequestWithId() req: Request
 */
export const RequestWithId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): Request => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request;
  },
);

/**
 * Decorator to extract custom context data from the request.
 * Usage: @RequestContext() context: { requestId: string; userId: string }
 */
export const RequestContext = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return {
      requestId: (request as any).requestId || 'unknown',
      userId: (request as any).user?.id || (request as any).userId,
      correlationId: (request as any).correlationId,
      ip: request.ip || request.socket.remoteAddress,
      userAgent: request.get('user-agent'),
    };
  },
);