import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from './feature-flags.service';
import { FEATURE_FLAG_KEY } from './feature-flag.decorator';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key =
      this.reflector.get<string>(FEATURE_FLAG_KEY, context.getHandler()) ||
      this.reflector.get<string>(FEATURE_FLAG_KEY, context.getClass());
    if (!key) return true;

    const request: Request = context.switchToHttp().getRequest();
    const enabled = await this.flags.isEnabled(key, { request });
    if (!enabled) throw new ForbiddenException(`Feature '${key}' is disabled`);
    return true;
  }
}
