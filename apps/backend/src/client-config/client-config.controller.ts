import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientConfigService } from './client-config.service';
import { StellarConfigDto } from './dto/stellar-config.dto';

/**
 * Exposes client-safe configuration to the frontend / mobile apps.
 *
 * All endpoints under this controller are intentionally public — they contain
 * no secrets and are designed to be fetched on application startup.
 */
@ApiTags('config')
@Controller({ path: 'config', version: '1' })
export class ClientConfigController {
  constructor(private readonly clientConfigService: ClientConfigService) {}

  /**
   * GET /v1/config/stellar
   *
   * Returns the Stellar network configuration that the frontend needs to
   * initialise the Soroban SDK and resolve contract IDs.  This replaces any
   * hardcoded values that previously lived in the client bundle.
   */
  @Get('stellar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get Stellar / Soroban client configuration',
    description:
      'Returns network info, Horizon URL, Soroban RPC URL, contract IDs, and ' +
      'explorer URL.  Safe to expose publicly — contains no secrets.',
  })
  @ApiResponse({
    status: 200,
    description: 'Stellar configuration retrieved successfully',
    type: StellarConfigDto,
  })
  getStellarConfig(): StellarConfigDto {
    return this.clientConfigService.getStellarConfig();
  }
}
