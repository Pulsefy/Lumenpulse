import {
  Controller,
  Get,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { StellarService } from './stellar.service';
import { AccountBalancesDto } from './dto/balance.dto';
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import stellarConfig from './config/stellar.config';

@ApiTags('stellar')
@Controller('stellar')
export class StellarController {
  constructor(
    private readonly stellarService: StellarService,
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
}
