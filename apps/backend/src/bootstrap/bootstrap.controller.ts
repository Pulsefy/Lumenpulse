import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { BootstrapService } from './bootstrap.service';
import {
  BootstrapDemoDataDto,
  BootstrapResponseDto,
} from './dto/bootstrap.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';

/**
 * Bootstrap API Controller
 *
 * Provides admin-only endpoints for bootstrapping demo data in testnet environments.
 * These endpoints are disabled in production via environment flags.
 *
 * @see BootstrapService for implementation details
 */
@ApiTags('bootstrap')
@Controller('bootstrap')
@ApiBearerAuth('JWT-auth')
export class BootstrapController {
  constructor(private readonly bootstrapService: BootstrapService) {}

  /**
   * Bootstrap demo data for testnet environments
   *
   * Creates a controlled set of demo projects and metadata in the database.
   * Useful for reviewers to quickly test the MVP without manual setup.
   *
   * **Security:**
   * - Admin-only endpoint (requires ADMIN role)
   * - Disabled in production by default (set BOOTSTRAP_ENABLED=true to override)
   * - Guarded by JWT authentication
   *
   * **Usage Example:**
   * ```bash
   * curl -X POST http://localhost:3000/bootstrap/demo-data \
   *   -H "Authorization: Bearer <JWT_TOKEN>" \
   *   -H "Content-Type: application/json" \
   *   -d '{"seed": "my-seed-123"}'
   * ```
   *
   * **Optional Parameters:**
   * - `seed`: Provides reproducible test data. Omit for random data.
   *
   * **Response Example:**
   * ```json
   * {
   *   "success": true,
   *   "projectsCreated": 5,
   *   "projects": [
   *     {
   *       "projectId": 1,
   *       "name": "Smart Contract Audit Services",
   *       "owner": "GBRPYHIL2CI3WHZDTOOQFC6EB4LEGWRL3OHUBNRQRNYC5JLVXCW2KV4",
   *       "targetAmount": "1000",
   *       "totalContributed": "0",
   *       "status": "ACTIVE",
   *       "createdAt": "2026-05-30T10:30:00Z"
   *     }
   *   ],
   *   "environment": "staging",
   *   "timestamp": "2026-05-30T10:30:00Z",
   *   "message": "Bootstrap completed successfully..."
   * }
   * ```
   *
   * @param dto Bootstrap request with optional seed parameter
   * @returns Response with created project IDs and metadata
   * @throws ForbiddenException if not admin, or if bootstrap is disabled in production
   * @throws BadRequestException if bootstrap fails
   */
  @Post('demo-data')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Bootstrap demo data for testnet',
    description:
      'Admin-only endpoint that creates demo projects and metadata for testing. ' +
      'Disabled in production by default. Returns created project IDs for verification.',
  })
  @ApiResponse({
    status: 201,
    description: 'Demo data created successfully',
    type: BootstrapResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized: JWT token missing or invalid',
  })
  @ApiResponse({
    status: 403,
    description:
      'Forbidden: User does not have ADMIN role or bootstrap is disabled',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request: Invalid input or bootstrap operation failed',
  })
  async bootstrapDemoData(
    @Body() dto: BootstrapDemoDataDto,
  ): Promise<BootstrapResponseDto> {
    return this.bootstrapService.bootstrapDemoData(dto);
  }
}
