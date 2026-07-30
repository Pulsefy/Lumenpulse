import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { GetUser, Roles } from '../../auth/decorators/auth.decorators';
import { User, UserRole } from '../../users/entities/user.entity';
import { getFriendbotBootstrapThrottleOverride } from '../../common/rate-limit/rate-limit.config';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { config } from '../../lib/config';
import {
  TestnetBootstrapRequestDto,
  TestnetBootstrapResponseDto,
} from '../dto/testnet-bootstrap.dto';
import { TestnetBootstrapService } from '../services/testnet-bootstrap.service';

/**
 * Developer-only testnet account bootstrap via Friendbot.
 *
 * Safeguards:
 * - Feature flag FRIENDBOT_BOOTSTRAP_ENABLED
 * - Service-level STELLAR_NETWORK=testnet gate
 * - JWT + ADMIN role
 * - Dedicated rate-limit profile
 * - Hardcoded Friendbot URL in the service
 */
@ApiTags('Developer - Testnet Bootstrap (Friendbot)')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('dev/testnet-bootstrap')
export class TestnetBootstrapController {
  private readonly logger = new Logger(TestnetBootstrapController.name);

  constructor(private readonly bootstrapService: TestnetBootstrapService) {}

  @Post('fund')
  @HttpCode(HttpStatus.OK)
  @Throttle(getFriendbotBootstrapThrottleOverride())
  @ApiOperation({
    summary: 'Fund a testnet account via Friendbot (testnet-only)',
    description:
      'Bootstrap a fresh testnet Stellar public key with Friendbot funding. ' +
      'Only available when STELLAR_NETWORK=testnet and FRIENDBOT_BOOTSTRAP_ENABLED=true. ' +
      'Requires an admin JWT and is rate-limited per caller.',
  })
  @ApiBody({
    type: TestnetBootstrapRequestDto,
    description: 'Testnet public key to fund',
  })
  @ApiResponse({
    status: 200,
    type: TestnetBootstrapResponseDto,
    description: 'Account successfully funded',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid public key or Friendbot rejected the request',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden, disabled, or not on testnet',
  })
  @ApiResponse({
    status: 429,
    description: 'Caller rate-limited or account recently funded',
  })
  @ApiResponse({
    status: 503,
    description: 'Friendbot is temporarily unavailable',
  })
  async fundAccount(
    @Body() dto: TestnetBootstrapRequestDto,
    @GetUser() user: User,
  ): Promise<TestnetBootstrapResponseDto> {
    if (!config.featureFlags.friendbotBootstrap) {
      throw new ForbiddenException({
        code: ErrorCode.SYS_FORBIDDEN,
        message:
          'Friendbot bootstrap is disabled. Set FRIENDBOT_BOOTSTRAP_ENABLED=true to enable it.',
      });
    }

    this.logger.log(
      `Admin ${user.id} requesting testnet bootstrap for ${dto.publicKey}`,
    );

    return this.bootstrapService.fundTestnetAccount(dto.publicKey);
  }
}
