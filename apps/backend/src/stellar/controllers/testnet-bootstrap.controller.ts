import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiHeader,
} from '@nestjs/swagger';
import { TestnetBootstrapService } from '../services/testnet-bootstrap.service';
import {
  TestnetBootstrapRequestDto,
  TestnetBootstrapResponseDto,
} from '../dto/testnet-bootstrap.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { Roles, UserRole } from '../../auth/decorators/auth.decorators';
import { Request as ExpressRequest } from 'express';

/**
 * Testnet-only account bootstrap controller.
 *
 * SECURITY NOTES:
 * - This endpoint is ONLY available on testnet deployments.
 * - Access is restricted to authenticated admin/developer users.
 * - Rate limiting is applied per authenticated user to prevent abuse.
 * - The actual environment gate is enforced in the service (fails closed).
 *
 * The hardcoded Friendbot URL and environment checks in TestnetBootstrapService
 * ensure this endpoint cannot be abused even if the guard is accidentally removed.
 */
@ApiTags('Developer — Testnet Bootstrap (Friendbot)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RateLimitGuard)
@Roles(UserRole.ADMIN, UserRole.DEVELOPER)
@Controller('dev/testnet-bootstrap')
export class TestnetBootstrapController {
  private readonly logger = new Logger(TestnetBootstrapController.name);

  constructor(private readonly bootstrapService: TestnetBootstrapService) {}

  /**
   * Fund a testnet account via Stellar's Friendbot faucet.
   *
   * TESTNET-ONLY ENDPOINT: This route is only functional when the application
   * is explicitly configured for testnet. Requests on mainnet or unset networks
   * will be rejected by the service with a 403 Forbidden response.
   *
   * RATE LIMITING: This endpoint is rate-limited per authenticated user to
   * prevent abuse. See rate-limit configuration for thresholds.
   *
   * USAGE:
   * ```bash
   * curl -X POST http://localhost:3000/dev/testnet-bootstrap \
   *   -H "Authorization: Bearer <JWT_TOKEN>" \
   *   -H "Content-Type: application/json" \
   *   -d '{"publicKey": "GBVEUUVRFP5SMZXSMJVFY42KTXFAPG4NFZR4MBBNGFQG6DGZX7NXQY2I"}'
   * ```
   *
   * @param dto - Request containing the testnet public key to fund
   * @returns Success response with transaction details
   *
   * @throws ForbiddenException (403) - Endpoint not available on mainnet
   * @throws BadRequestException (400) - Invalid public key format
   * @throws TooManyRequestsException (429) - Friendbot rate-limited for this account
   * @throws ServiceUnavailableException (503) - Friendbot is down
   * @throws UnauthorizedException (401) - Invalid or missing JWT token
   */
  @Post('fund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fund a testnet account via Friendbot (testnet-only)',
    description:
      'Bootstrap a fresh testnet Stellar public key with initial lumens. ' +
      'This endpoint is only available when the app is configured for testnet. ' +
      'Requires admin/developer authentication. ' +
      'Subject to rate limiting per caller to prevent abuse.',
  })
  @ApiHeader({
    name: 'Authorization',
    description: 'Bearer <JWT_TOKEN>',
    required: true,
  })
  @ApiBody({
    type: TestnetBootstrapRequestDto,
    description: 'Testnet public key to fund',
    example: {
      publicKey: 'GBVEUUVRFP5SMZXSMJVFY42KTXFAPG4NFZR4MBBNGFQG6DGZX7NXQY2I',
    },
  })
  @ApiResponse({
    status: 200,
    type: TestnetBootstrapResponseDto,
    description: 'Account successfully funded',
    example: {
      success: true,
      message: 'Account successfully funded via Friendbot',
      publicKey: 'GBVEUUVRFP5SMZXSMJVFY42KTXFAPG4NFZR4MBBNGFQG6DGZX7NXQY2I',
      transactionHash:
        'baaffabaffabaffabaffabaffabaffabaffabaffabaffabaffabaffaba0',
      fundingAmount: '100.0000000',
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid public key format',
    schema: {
      example: {
        code: 'STEL_004',
        message: 'Invalid Stellar public key format',
        requestId: 'req-uuid-here',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - missing or invalid JWT',
    schema: {
      example: {
        code: 'AUTH_001',
        message: 'Unauthorized',
        requestId: 'req-uuid-here',
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Endpoint not available - not on testnet',
    schema: {
      example: {
        code: 'STEL_010',
        message:
          'This endpoint is only available on testnet. Current deployment is configured for mainnet',
        requestId: 'req-uuid-here',
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limited - either by caller or by Friendbot',
    schema: {
      example: {
        code: 'SYS_008',
        message: 'Rate limit exceeded',
        retryAfterSeconds: 60,
        requestId: 'req-uuid-here',
      },
    },
  })
  @ApiResponse({
    status: 429,
    description: 'Account already recently funded by Friendbot',
    schema: {
      example: {
        code: 'STEL_008',
        message:
          'This account was recently funded by Friendbot. Please try again later.',
        retryAfterSeconds: 300,
        requestId: 'req-uuid-here',
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Friendbot is temporarily unavailable',
    schema: {
      example: {
        code: 'STEL_007',
        message: 'Friendbot is temporarily unavailable. Please try again later.',
        requestId: 'req-uuid-here',
      },
    },
  })
  async fundAccount(
    @Body() dto: TestnetBootstrapRequestDto,
    @Request() req: ExpressRequest,
  ): Promise<TestnetBootstrapResponseDto> {
    const user = (req as any).user;
    this.logger.log(
      `Admin ${user?.id || 'unknown'} requesting testnet bootstrap for ${dto.publicKey}`,
    );

    return this.bootstrapService.fundTestnetAccount(dto.publicKey);
  }
}
