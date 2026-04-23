import {
  SetMetadata,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { Request } from 'express';
import { User, UserRole } from '../../users/entities/user.entity';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route to users with specific roles.
 * Must be combined with JwtAuthGuard + RolesGuard.
 *
 * @example
 * @Roles(UserRole.ADMIN)
 * @UseGuards(JwtAuthGuard, RolesGuard)
 * @Post()
 * create(@Body() dto: CreateDto) { ... }
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Decorator to mark routes as public (skip JWT authentication)
 */
export const Public = () => SetMetadata('isPublic', true);

/**
 * Decorator to get the current authenticated user
 * Usage: @GetUser() user: User
 */
export const GetUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user as User;
  },
);

/**
 * Decorator to get the user's Stellar public key
 * Usage: @GetStellarPublicKey() publicKey: string
 */
export const GetStellarPublicKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as { stellarPublicKey?: string };

    if (!user?.stellarPublicKey) {
      throw new Error('Stellar public key not found on request user');
    }

    return user.stellarPublicKey;
  },
);
