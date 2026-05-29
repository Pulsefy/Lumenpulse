import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../users/entities/user.entity';

@Injectable()
export class AdminAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly configService: ConfigService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (authHeader && authHeader.startsWith('Basic ')) {
      const basicToken = authHeader.substring(6);
      const decoded = Buffer.from(basicToken, 'base64').toString('utf8');
      const [username, password] = decoded.split(':');

      const expectedUsername =
        this.configService.get<string>('ADMIN_USERNAME') || 'admin';
      const expectedPassword =
        this.configService.get<string>('ADMIN_PASSWORD') ||
        'admin-secret-lumenpulse-2026';

      if (username === expectedUsername && password === expectedPassword) {
        request.user = {
          role: UserRole.ADMIN,
          email: 'admin@lumenpulse.io',
          stellarPublicKey:
            this.configService.get<string>(
              'STELLAR_CONTRACT_MATCHING_POOL_ADMIN',
            ) || 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        };
        return true;
      }
      throw new UnauthorizedException('Invalid basic auth credentials');
    }

    // Fall back to JWT authentication
    let isJwtSuccess: boolean;
    try {
      const result = super.canActivate(context);
      isJwtSuccess =
        result instanceof Promise ? await result : (result as boolean);
    } catch (err) {
      throw new UnauthorizedException(
        err instanceof Error ? err.message : 'JWT authentication failed',
      );
    }

    if (!isJwtSuccess) {
      return false;
    }

    // Role check for ADMIN
    const user = request.user;
    if (!user || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'You do not have permission to access this resource',
      );
    }

    return true;
  }
}
