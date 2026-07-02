import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import {
  WalletReadinessQueryDto,
  WalletReadinessResponseDto,
} from './dto/wallet.dto';

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post('readiness')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate wallet readiness for a specific action',
    description:
      'Checks if a wallet is ready for a given testnet action before attempting a transaction. Validates account existence, funding status, trustlines, and action-specific requirements.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Wallet readiness validation completed',
    type: WalletReadinessResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request parameters',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error',
  })
  async validateWalletReadiness(
    @Body() query: WalletReadinessQueryDto,
  ): Promise<WalletReadinessResponseDto> {
    return this.walletService.validateWalletReadiness(query);
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check for wallet service' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Wallet service health status',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        stellar: { type: 'boolean' },
        cache: { type: 'boolean' },
      },
    },
  })
  async healthCheck(): Promise<{
    status: string;
    stellar: boolean;
    cache: boolean;
  }> {
    return this.walletService.healthCheck();
  }
}
