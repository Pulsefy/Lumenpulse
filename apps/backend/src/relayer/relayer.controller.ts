import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { RelayerService } from './relayer.service';
import { RelayIntentDto } from './dto/relay-intent.dto';
import { getAuthThrottleOverride } from '../common/rate-limit/rate-limit.config';

class NonceQueryDto {
  @IsString()
  @IsNotEmpty()
  publicKey!: string;

  @IsString()
  @IsNotEmpty()
  contractId!: string;
}

@ApiTags('relayer')
@Controller('relayer')
export class RelayerController {
  private readonly logger = new Logger(RelayerController.name);

  constructor(private readonly relayerService: RelayerService) {}

  /**
   * GET /relayer/nonce?publicKey=G...&contractId=C...
   *
   * Returns the current `RegistrationNonce` for a given address so the
   * frontend can embed the correct value in the auth-entry scope before
   * asking Freighter to sign.
   */
  @Get('nonce')
  @ApiOperation({ summary: 'Fetch current registration nonce for an address' })
  @ApiQuery({ name: 'publicKey', required: true, description: "User's G-address" })
  @ApiQuery({ name: 'contractId', required: true, description: 'Contract ID' })
  @ApiResponse({
    status: 200,
    schema: { properties: { nonce: { type: 'number' } } },
  })
  async getNonce(@Query() query: NonceQueryDto): Promise<{ nonce: number }> {
    const nonce = await this.relayerService.getRegistrationNonce(
      query.publicKey,
      query.contractId,
    );
    return { nonce };
  }

  /**
   * POST /relayer/intent
   *
   * Accept a user's signed off-chain intent and have the relayer submit it
   * on-chain, paying all fees.  The user never needs XLM.
   */
  @Post('intent')
  @Throttle(getAuthThrottleOverride())
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Relay a user-signed off-chain intent (gasless UX)',
    description:
      'Accepts a SorobanAuthorizationEntry signed by the user and submits the ' +
      'transaction using the relayer account, enabling gas-less interactions.',
  })
  @ApiResponse({
    status: 200,
    description: 'Intent relayed successfully',
    schema: {
      properties: {
        txHash: { type: 'string', example: 'abc123...' },
        status: { type: 'string', example: 'PENDING' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid intent or auth entry XDR' })
  @ApiResponse({ status: 500, description: 'Relayer or RPC failure' })
  async relayIntent(@Body() dto: RelayIntentDto) {
    this.logger.log(
      `Relaying ${dto.intentType} intent for ${dto.userPublicKey}`,
    );
    return this.relayerService.relayIntent(dto);
  }
}
