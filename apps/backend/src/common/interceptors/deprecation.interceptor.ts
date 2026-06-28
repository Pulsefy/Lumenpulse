import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Response, Request } from 'express';
import {
  DEPRECATED_KEY,
  DEPRECATION_META_KEY,
  DeprecationOptions,
} from '../decorators/deprecated.decorator';

@Injectable()
export class DeprecationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DeprecationInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isDeprecated = this.reflector.getAllAndOverride<boolean>(
      DEPRECATED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!isDeprecated) {
      return next.handle();
    }

    const meta = this.reflector.getAllAndOverride<DeprecationOptions>(
      DEPRECATION_META_KEY,
      [context.getHandler(), context.getClass()],
    );

    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest<Request>();

    response.setHeader('Deprecation', `version="${meta.since}"`);

    if (meta.removeIn) {
      response.setHeader('Sunset', `version="${meta.removeIn}"`);
    }

    if (meta.replacement) {
      response.setHeader(
        'Link',
        `<${meta.replacement}>; rel="successor-version"`,
      );
    }

    this.logger.warn(
      `Deprecated endpoint called: ${request.method} ${request.url} — ` +
        `deprecated since ${meta.since}` +
        (meta.removeIn ? `, removal planned in ${meta.removeIn}` : '') +
        (meta.replacement ? `, use ${meta.replacement} instead` : ''),
    );

    return next.handle().pipe(tap(() => {}));
  }
}
