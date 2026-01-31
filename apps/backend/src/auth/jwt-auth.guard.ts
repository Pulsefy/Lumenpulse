import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  // handleRequest(
  //   err: unknown,
  //   user: unknown,
  //   info: unknown,
  // ): User {
  //   if (err || !user) {
  //     const message =
  //       info instanceof Error
  //         ? info.message
  //         : typeof info === 'object' && info !== null && 'message' in info
  //         ? String((info as { message: unknown }).message)
  //         : 'Invalid or expired token';

  //     this.logger.warn(`Authentication failed: ${message}`);

  //     throw err instanceof Error
  //       ? err
  //       : new UnauthorizedException(message);
  //   }

  //   return user as User;
  // }

  handleRequest<TUser = any>(
  err: unknown,
  user: TUser,
  info: unknown,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _context: ExecutionContext,
   // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _status?: unknown,
): TUser {
  if (err || !user) {
    const message =
      info instanceof Error
        ? info.message
        : typeof info === 'object' && info !== null && 'message' in info
        ? String((info as { message: unknown }).message)
        : 'Invalid or expired token';

    this.logger.warn(`Authentication failed: ${message}`);

    throw err instanceof Error
      ? err
      : new UnauthorizedException(message);
  }

  return user;
}

}
