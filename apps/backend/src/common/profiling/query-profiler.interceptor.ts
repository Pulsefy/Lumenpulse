import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import {
  PROFILE_QUERY_KEY,
  ProfileQueryMetadata,
} from './profile-query.decorator';

@Injectable()
export class QueryProfilerInterceptor implements NestInterceptor {
  private readonly logger = new Logger(QueryProfilerInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.getAllAndOverride<ProfileQueryMetadata>(
      PROFILE_QUERY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!metadata) {
      return next.handle();
    }

    const start = performance.now();
    return next.handle().pipe(
      tap(() => {
        const duration = performance.now() - start;
        if (duration > metadata.thresholdMs) {
          this.logger.warn(
            `[SLOW QUERY] ${metadata.label} took ${duration.toFixed(2)}ms (threshold: ${metadata.thresholdMs}ms)`,
          );
        } else {
          this.logger.debug(
            `[QUERY] ${metadata.label} took ${duration.toFixed(2)}ms`,
          );
        }
      }),
    );
  }
}
