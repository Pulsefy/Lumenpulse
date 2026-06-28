import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseInterceptors,
} from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from './config.service';
import { StellarConfigResponseDto } from './dto/stellar-config.dto';

@ApiTags('config')
@Controller({ path: 'config', version: '1' })
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Returns client-safe Stellar network configuration: network name, Horizon URL,
   * Soroban RPC URL, network passphrase, and deployed contract addresses.
   *
   * This endpoint is intentionally public (no auth) because it only exposes
   * non-secret, environment-specific configuration that the frontend needs
   * at startup. No secrets (keys, tokens, DB credentials) are ever included.
   */
  @Get('stellar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300_000) // 5 minutes — config rarely changes at runtime
  @ApiOperation({
    summary: 'Get Stellar testnet/mainnet configuration',
    description:
      'Returns client-safe Stellar network configuration including network name, API endpoints (Horizon and Soroban RPC), ' +
      'network passphrase for transaction signing, and all deployed smart contract addresses. ' +
      'This endpoint is public (no authentication required) as it only exposes environment-specific, non-sensitive configuration ' +
      'that frontend applications need at startup. The response is cached for 5 minutes. ' +
      "This endpoint supports both testnet and mainnet depending on the server's configuration.",
  })
  @ApiResponse({
    status: 200,
    description:
      'Stellar configuration retrieved successfully. Contains network identification, API endpoints for Horizon and Soroban, ' +
      'and all deployed contract addresses on the network. Any null contract addresses indicate that contract has not been deployed on this network.',
    type: StellarConfigResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error - Failed to retrieve configuration',
  })
  getStellarConfig(): StellarConfigResponseDto {
    return this.configService.getStellarConfig();
  }
}
