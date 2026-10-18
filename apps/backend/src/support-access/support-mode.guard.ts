import {
  CanActivate,
  ExecutionContext,
} from '@common/guards/can-activate.guard';
import { Injectable, CanActivate as NestCanActivate, ExecutionContext as NestExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { SupportAccessService } from './support-access.service';

export interface SupportSessionRequest extends Request {
  supportSession?: {
    id: string;
    actorId: string;
    subjectId: string;
    readOnly: true;
  };
}

@Injectable()
export class SupportModeGuard implements NestCanActivate {
  constructor(private readonly supportAccessService: SupportAccessService) {}

  async canActivate(context: NestExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SupportSessionRequest>();
    const session = request.supportSession;

    if (!session) {
      return true;
    }

    const method = (request.method || 'GET').toUpperCase();
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method);

    if (isWrite) {
      await this.supportAccessService.recordDeniedWrite(session.id, {
        method,
        path: request.originalUrl || request.url,
      });
      return false;
    }

    const valid = await this.supportAccessService.recordAccess(session.id, {
      method,
      path: request.originalUrl || request.url,
    });

    return valid;
  }
}
