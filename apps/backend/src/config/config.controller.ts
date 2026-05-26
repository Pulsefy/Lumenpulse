import { Controller, Get, HttpCode, HttpStatus, UseInterceptors } from '@nestjs/common';
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
    summary: 'Get Stellar network configuration',
    description:
      'Returns client-safe Stellar network info and deployed contract addresses. ' +
      'No authentication required. Intended to be fetched by the frontend on startup.',
  })
  @ApiResponse({
    status: 200,
    description: 'Stellar configuration retrieved successfully',
    type: StellarConfigResponseDto,
  })
  getStellarConfig(): StellarConfigResponseDto {
    return this.configService.getStellarConfig();
  }
}
