import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from '../audit.service';
import { AUDIT_LOG_ACTION_KEY } from '../decorators/audit-log.decorator';
import { UsersService } from '../../users/users.service';

interface RequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  connection?: { remoteAddress?: string };
  body?: Record<string, unknown>;
  user?: { id?: string; sub?: string };
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
    private readonly usersService: UsersService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const action = this.reflector.get<string>(
      AUDIT_LOG_ACTION_KEY,
      context.getHandler(),
    );

    if (!action) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    let ipAddress: string | null = null;
    const xForwardedFor = request.headers['x-forwarded-for'];
    if (typeof xForwardedFor === 'string') {
      ipAddress = xForwardedFor.split(',')[0].trim();
    } else if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
      ipAddress = xForwardedFor[0].split(',')[0].trim();
    } else {
      ipAddress = request.ip || request.connection?.remoteAddress || null;
    }

    // Filter out sensitive data from request body metadata
    const metadata = request.body ? { ...request.body } : {};
    const sensitiveKeys = [
      'password',
      'newPassword',
      'token',
      'signedChallenge',
    ];
    for (const key of sensitiveKeys) {
      if (key in metadata) {
        metadata[key] = '[REDACTED]';
      }
    }

    return next.handle().pipe(
      tap((response: unknown) => {
        // Execute logging asynchronously as fire-and-forget
        void (async () => {
          let userId: string | null = null;

          // 1. Check if user is already authenticated
          if (request.user?.id) {
            userId = request.user.id;
          } else if (request.user?.sub) {
            userId = request.user.sub;
          }

          // 2. If login or password reset, resolve user by email from request body
          if (
            !userId &&
            request.body &&
            typeof request.body.email === 'string'
          ) {
            try {
              const user = await this.usersService.findByEmail(
                request.body.email,
              );
              if (user) {
                userId = user.id;
              }
            } catch {
              // Ignore error
            }
          }

          // 3. If response contains user object
          if (!userId && response && typeof response === 'object') {
            const resObj = response as { user?: { id?: string } };
            if (resObj.user?.id) {
              userId = resObj.user.id;
            }
          }

          await this.auditService.log(action, userId, ipAddress, metadata);
        })();
      }),
    );
  }
}
