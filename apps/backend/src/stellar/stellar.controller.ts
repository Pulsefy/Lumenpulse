import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseInterceptors,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { StellarService } from './stellar.service';
import { AccountBalancesDto } from './dto/balance.dto';
import {
  AssetDiscoveryQueryDto,
  AssetDiscoveryResponseDto,
} from './dto/asset-discovery.dto';
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import stellarConfig from './config/stellar.config';
import { TransactionService } from '../transaction/transaction.service';
import { TransactionHistoryResponseDto } from '../transaction/dto/transaction.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('stellar')
@Controller('stellar')
export class StellarController {
  constructor(
    private readonly stellarService: StellarService,
    private readonly transactionService: TransactionService,
    @Inject(stellarConfig.KEY)
    private readonly config: ConfigType<typeof stellarConfig>,
  ) {}

  @Get('accounts/:publicKey/balances')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get account balances',
    description:
      'Fetches real-time token balances for a given Stellar public key from the Horizon API (Testnet)',
  })
  @ApiParam({
    name: 'publicKey',
    description: 'Stellar account public key',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @ApiResponse({
    status: 200,
    description: 'Account balances retrieved successfully',
    type: AccountBalancesDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Account not found',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async getAccountBalances(
    @Param('publicKey') publicKey: string,
  ): Promise<AccountBalancesDto> {
    // Service handles all exceptions and throws appropriate HttpExceptions
    return this.stellarService.getAccountBalances(publicKey);
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check Horizon API health',
    description:
      'Verifies if the Stellar Horizon API is available and responsive',
  })
  @ApiResponse({
    status: 200,
    description: 'Horizon API is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        horizonUrl: { type: 'string' },
        network: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Horizon API is unavailable',
  })
  async checkHealth(): Promise<{
    status: string;
    horizonUrl: string;
    network: string;
  }> {
    const isHealthy = await this.stellarService.checkHealth();

    if (!isHealthy) {
      throw new BadRequestException('Horizon API is unavailable');
    }

    return {
      status: 'healthy',
      horizonUrl: this.config.horizonUrl,
      network: this.config.network,
    };
  }

  @Get('transactions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60_000)
  @ApiOperation({
    summary: 'Get transaction history for a Stellar account',
    description:
      'Fetches and formats paginated transaction history for a given Stellar public key from Horizon. Includes human-readable descriptions for each operation type.',
  })
  @ApiParam({
    name: 'publicKey',
    required: false,
    description: 'Stellar account public key',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @ApiQuery({
    name: 'publicKey',
    required: true,
    description: 'Stellar account public key',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of transactions to return (default: 50, max: 200)',
    example: 50,
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Pagination cursor from previous response',
  })
  @ApiResponse({
    status: 200,
    description: 'Transaction history retrieved successfully',
    type: TransactionHistoryResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid public key' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 503, description: 'Horizon API unavailable' })
  async getTransactions(
    @Query('publicKey') publicKey: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ): Promise<TransactionHistoryResponseDto> {
    if (!publicKey) {
      throw new BadRequestException('publicKey query parameter is required');
    }

    const clampedLimit = Math.min(Math.max(limit, 1), 200);

    const { transactions, nextPage } =
      await this.transactionService.getTransactionHistory(
        publicKey,
        clampedLimit,
        cursor,
      );

    return {
      transactions,
      total: transactions.length,
      nextPage,
    };
  }

  @Get('assets')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(600_000)
  @ApiOperation({
    summary: 'Discover Stellar assets',
    description:
      'Search for Stellar assets by code, issuer, or partial match with pagination support',
  })
  @ApiResponse({
    status: 200,
    description: 'Assets discovered successfully',
    type: AssetDiscoveryResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid query parameters',
  })
  @ApiResponse({
    status: 503,
    description: 'Horizon API is unavailable',
  })
  async discoverAssets(
    @Query() query: AssetDiscoveryQueryDto,
  ): Promise<AssetDiscoveryResponseDto> {
    // Service handles all exceptions and throws appropriate HttpExceptions
    return this.stellarService.discoverAssets(query);
  }
}
