import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../users/entities/user.entity';

@Injectable()
export class ReviewerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return false;
    }

    return user.role === UserRole.ADMIN;
  }
}
