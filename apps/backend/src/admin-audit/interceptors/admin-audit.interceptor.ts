import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request, Response } from 'express';
import { AdminAuditService } from '../admin-audit.service';
import {
  AUDIT_BLOCKCHAIN_KEY,
  AuditBlockchainMeta,
} from '../decorators/audit-blockchain-action.decorator';
import { User } from '../../users/entities/user.entity';

interface RequestWithUser extends Request {
  user?: User;
}

function pick(obj: unknown, field: string): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const val = (obj as Record<string, unknown>)[field];
  if (val === undefined || val === null) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return val.toString(10);
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'bigint') return val.toString(10);
  return JSON.stringify(val);
}

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditService: AdminAuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditBlockchainMeta | undefined>(
      AUDIT_BLOCKCHAIN_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Only audit routes decorated with @AuditBlockchainAction
    if (!meta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const response = context.switchToHttp().getResponse<Response>();
    const user = request.user;
    const method = request.method;
    const endpoint = `${method} ${request.path}`;

    // Merge body + params as the params summary
    const rawParams: Record<string, unknown> = {
      ...(typeof request.body === 'object' && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {}),
      ...(request.params as Record<string, unknown>),
    };

    const contractField = meta.contractField;
    const targetContract = contractField ? pick(rawParams, contractField) : null;

    return next.handle().pipe(
      tap({
        next: (responseBody: unknown) => {
          const txHash = meta.txHashField
            ? pick(responseBody, meta.txHashField)
            : null;

          void this.auditService.create({
            actorId: user?.id ?? 'unknown',
            actorEmail: user?.email ?? null,
            endpoint,
            targetContract,
            params: rawParams,
            txHash,
            responseStatus: response.statusCode,
          });
        },
        error: (err: unknown) => {
          const status =
            (err as Record<string, unknown>)?.status ??
            (err as Record<string, unknown>)?.statusCode ??
            500;

          void this.auditService.create({
            actorId: user?.id ?? 'unknown',
            actorEmail: user?.email ?? null,
            endpoint,
            targetContract,
            params: rawParams,
            txHash: null,
            responseStatus: status as number,
          });
        },
      }),
    );
  }
}
