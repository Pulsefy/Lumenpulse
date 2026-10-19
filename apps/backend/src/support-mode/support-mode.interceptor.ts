import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { SupportModeService } from './support-mode.service';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

interface SupportRequest {
  method: string;
  originalUrl?: string;
  url?: string;
  user?: { supportSessionId?: string };
}

/**
 * Server-side enforcement of read-only support mode. Runs after the route's
 * auth guards (so `request.user` is populated) and before the handler:
 * any request authenticated by a support token that is not a plain GET/HEAD
 * is rejected, and every permitted access is recorded on the session.
 */
@Injectable()
export class SupportModeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SupportModeInterceptor.name);

  constructor(private readonly supportMode: SupportModeService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<SupportRequest>();
    const sessionId = req.user?.supportSessionId;
    if (!sessionId) return next.handle();

    const path = req.originalUrl ?? req.url ?? '';

    if (!SAFE_METHODS.has(req.method.toUpperCase())) {
      // Record the blocked attempt too: it is relevant to a later review.
      await this.record(sessionId, `BLOCKED ${req.method.toUpperCase()}`, path);
      throw new ForbiddenException(
        'Support mode is read-only: write operations are not permitted',
      );
    }

    await this.record(sessionId, req.method.toUpperCase(), path);
    return next.handle();
  }

  private async record(
    sessionId: string,
    method: string,
    path: string,
  ): Promise<void> {
    try {
      await this.supportMode.recordAccess(sessionId, method, path);
    } catch (err) {
      this.logger.error(
        `Failed to record support access: ${(err as Error).message}`,
      );
      // Fail closed: an access that cannot be audited must not happen.
      throw new ForbiddenException('Support access could not be recorded');
    }
  }
}
