import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { CrowdfundSyncService } from './crowdfund-sync.service';
import {
  SyncVaultDto,
  SyncVaultResponseDto,
  ListVaultEventsDto,
  VaultEventResponseDto,
  DeadLetterListDto,
  DeadLetterStatsResponseDto,
  ReplayDeadLetterDto,
  ResolveDeadLetterDto,
  ReplayResponseDto,
  VaultSyncStatsDto,
} from './dto/crowdfund-sync.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('crowdfund-sync')
@UseGuards(JwtAuthGuard)
export class CrowdfundSyncController {
  constructor(private readonly syncService: CrowdfundSyncService) {}

  /**
   * Sync a specific vault
   */
  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  async syncVault(@Body() dto: SyncVaultDto): Promise<SyncVaultResponseDto> {
    return this.syncService.syncVault(dto);
  }

  /**
   * List vault events
   */
  @Get('events')
  async listEvents(@Query() query: ListVaultEventsDto): Promise<{
    data: VaultEventResponseDto[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }> {
    return this.syncService.listEvents(query);
  }

  /**
   * Get vault sync statistics
   */
  @Get('vaults/:vaultAddress/stats')
  async getVaultStats(
    @Param('vaultAddress') vaultAddress: string,
  ): Promise<VaultSyncStatsDto> {
    return this.syncService.getVaultStats(vaultAddress);
  }

  /**
   * Register a vault for syncing
   */
  @Post('vaults')
  async registerVault(
    @Body()
    body: {
      vaultAddress: string;
      projectId: string;
      contractAddress?: string;
      tokenAddress?: string;
      ownerAddress?: string;
    },
  ) {
    return this.syncService.registerVault(
      body.vaultAddress,
      body.projectId,
      body.contractAddress,
      body.tokenAddress,
      body.ownerAddress,
    );
  }

  /**
   * List dead letter queue entries
   */
  @Get('dead-letter')
  async listDeadLetters(@Query() query: DeadLetterListDto) {
    return this.syncService.listDeadLetters(query);
  }

  /**
   * Get dead letter statistics
   */
  @Get('dead-letter/stats')
  async getDeadLetterStats(): Promise<DeadLetterStatsResponseDto> {
    return this.syncService.getDeadLetterStats();
  }

  /**
   * Inspect a dead letter entry
   */
  @Get('dead-letter/:id')
  async inspectDeadLetter(@Param('id') id: string) {
    return this.syncService.inspectDeadLetter(id);
  }

  /**
   * Replay a dead letter event
   */
  @Post('dead-letter/:id/replay')
  @HttpCode(HttpStatus.ACCEPTED)
  async replayDeadLetter(
    @Param('id') id: string,
    @Body() body: ReplayDeadLetterDto,
  ): Promise<ReplayResponseDto> {
    return this.syncService.replayDeadLetter(id, body.reason);
  }

  /**
   * Resolve a dead letter entry
   */
  @Patch('dead-letter/:id/resolve')
  async resolveDeadLetter(
    @Param('id') id: string,
    @Body() body: ResolveDeadLetterDto,
  ): Promise<{ message: string; eventId: string }> {
    return this.syncService.resolveDeadLetter(id, body.reason, body.resolvedBy);
  }
}
