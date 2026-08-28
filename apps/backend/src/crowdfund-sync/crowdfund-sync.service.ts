import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, MoreThan, FindOptionsWhere } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { rpc } from '@stellar/stellar-sdk';
import {
  CrowdfundVaultEvent,
  CrowdfundVaultEventType,
  CrowdfundVaultEventStatus,
} from './entities/crowdfund-vault-event.entity';
import { CrowdfundVaultCursor } from './entities/crowdfund-vault-cursor.entity';
import {
  CrowdfundVaultDeadLetter,
  DeadLetterStatus,
} from './entities/crowdfund-vault-dead-letter.entity';
import { CrowdfundVaultProject } from './entities/crowdfund-vault-project.entity';
import {
  SyncVaultDto,
  SyncVaultResponseDto,
  ListVaultEventsDto,
  VaultEventResponseDto,
  DeadLetterListDto,
  DeadLetterStatsResponseDto,
  ReplayResponseDto,
  VaultSyncStatsDto,
} from './dto/crowdfund-sync.dto';
import { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';

const JOB_NAME = 'crowdfund-vault-sync';
const MAX_LEDGER_RANGE_PER_RUN = 1000;
const PAGE_LIMIT = 100;
const MAX_REPLAY_ATTEMPTS = 5;

// Event topic signatures for crowdfund vault contracts
const EVENT_TOPICS = {
  CONTRIBUTION: 'contribution',
  MILESTONE_APPROVED: 'milestone_approved',
  FUNDS_WITHDRAWN: 'funds_withdrawn',
  VAULT_CREATED: 'vault_created',
  REFUND_INITIATED: 'refund_initiated',
  REFUND_COMPLETED: 'refund_completed',
} as const;

interface NormalizedEventData {
  from?: string;
  to?: string;
  amount?: string;
  milestoneId?: string;
  milestoneIndex?: number;
  totalContributions?: string;
  contributorCount?: number;
  refundWindowStart?: number;
  refundWindowEnd?: number;
  contributionData?: {
    contributor: string;
    amount: string;
    timestamp: number;
  };
  milestoneData?: {
    id: string;
    title: string;
    approvedAt: number;
    approvedBy: string;
  };
  withdrawalData?: {
    amount: string;
    recipient: string;
    reason: string;
    timestamp: number;
  };
}

@Injectable()
export class CrowdfundSyncService {
  private readonly logger = new Logger(CrowdfundSyncService.name);

  constructor(
    @InjectRepository(CrowdfundVaultEvent)
    private readonly eventRepo: Repository<CrowdfundVaultEvent>,
    @InjectRepository(CrowdfundVaultCursor)
    private readonly cursorRepo: Repository<CrowdfundVaultCursor>,
    @InjectRepository(CrowdfundVaultDeadLetter)
    private readonly deadLetterRepo: Repository<CrowdfundVaultDeadLetter>,
    @InjectRepository(CrowdfundVaultProject)
    private readonly projectRepo: Repository<CrowdfundVaultProject>,
    private readonly rpcClient: SorobanRpcClientService,
    private readonly jobLock: JobLockService,
    private readonly jobHistory: JobHistoryService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Synchronize a specific vault from the blockchain
   */
  async syncVault(dto: SyncVaultDto): Promise<SyncVaultResponseDto> {
    const { vaultAddress, fromLedger, toLedger, limit } = dto;

    this.logger.log(
      `Syncing vault ${vaultAddress} from ledger ${fromLedger ?? 'cursor'}`,
    );

    try {
      // Validate vault exists
      const vault = await this.projectRepo.findOne({
        where: { vaultAddress },
      });

      if (!vault) {
        throw new NotFoundException(
          `Vault ${vaultAddress} not found in registry`,
        );
      }

      // Get or create cursor
      let cursor = await this.cursorRepo.findOne({
        where: { vaultAddress },
      });

      if (!cursor) {
        cursor = this.cursorRepo.create({
          vaultAddress,
          lastLedgerSequence: fromLedger ?? 0,
          safeLedgerSequence: 0,
        });
        await this.cursorRepo.save(cursor);
      }

      const startLedger = fromLedger ?? cursor.lastLedgerSequence + 1;
      const latestLedger = await this.fetchLatestLedger();

      if (latestLedger === null) {
        throw new Error('Failed to fetch latest ledger from RPC');
      }

      const endLedger =
        toLedger ??
        Math.min(
          startLedger + (limit ?? MAX_LEDGER_RANGE_PER_RUN) - 1,
          latestLedger,
        );

      if (startLedger > endLedger) {
        return {
          vaultAddress,
          syncedFrom: startLedger,
          syncedTo: endLedger,
          eventsFound: 0,
          eventsProcessed: 0,
          status: 'success',
        };
      }

      // Fetch events from the blockchain
      const events = await this.fetchVaultEvents(
        vaultAddress,
        startLedger,
        endLedger,
      );

      // Process events in ledger order
      let processedCount = 0;
      const eventsFound = events.length;

      for (const event of events) {
        const processed = await this.processVaultEvent(event, vault);
        if (processed) {
          processedCount++;
        }
      }

      // Update cursor
      cursor.lastLedgerSequence = endLedger;
      cursor.lastSyncedAt = new Date();
      cursor.consecutiveFailures = 0;
      await this.cursorRepo.save(cursor);

      // Detect and handle potential reorgs
      await this.detectReorgs(vaultAddress);

      this.logger.log(
        `Synced vault ${vaultAddress}: ${eventsFound} events, ${processedCount} processed, ledgers ${startLedger}-${endLedger}`,
      );

      return {
        vaultAddress,
        syncedFrom: startLedger,
        syncedTo: endLedger,
        eventsFound,
        eventsProcessed: processedCount,
        status: 'success',
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to sync vault ${vaultAddress}: ${errorMessage}`,
      );

      // Update failure count
      const cursor = await this.cursorRepo.findOne({
        where: { vaultAddress },
      });

      if (cursor) {
        cursor.consecutiveFailures += 1;
        await this.cursorRepo.save(cursor);
      }

      return {
        vaultAddress,
        syncedFrom: fromLedger ?? 0,
        syncedTo: toLedger ?? 0,
        eventsFound: 0,
        eventsProcessed: 0,
        status: 'failed',
        error: errorMessage,
      };
    }
  }

  /**
   * Scheduled sync for all active vaults
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async syncAllVaults(): Promise<void> {
    await this.jobLock.withLock(JOB_NAME, async () => {
      const activeVaults = await this.projectRepo.find({
        where: { isActive: true },
      });

      this.logger.log(`Syncing ${activeVaults.length} active vaults`);

      for (const vault of activeVaults) {
        try {
          await this.syncVault({
            vaultAddress: vault.vaultAddress,
          });
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to sync vault ${vault.vaultAddress}: ${errorMessage}`,
          );
        }
      }
    });
  }

  /**
   * Fetch events for a specific vault from Soroban RPC
   */
  private async fetchVaultEvents(
    vaultAddress: string,
    startLedger: number,
    endLedger: number,
  ): Promise<rpc.Api.EventResponse[]> {
    const server = this.rpcClient.rawServer;
    const allEvents: rpc.Api.EventResponse[] = [];
    let pageCursor: string | undefined;

    let hasMore = true;
    while (hasMore) {
      const request: rpc.Api.GetEventsRequest = pageCursor
        ? {
            filters: [
              {
                contractIds: [vaultAddress],
              },
            ],
            cursor: pageCursor,
            limit: PAGE_LIMIT,
          }
        : {
            filters: [
              {
                contractIds: [vaultAddress],
              },
            ],
            startLedger,
            endLedger,
            limit: PAGE_LIMIT,
          };

      const response = await server.getEvents(request);

      if (!response.events || response.events.length === 0) {
        break;
      }

      // Filter to events within our target ledger range and matching known topics
      const eventsInRange = response.events.filter(
        (e) =>
          e.ledger >= startLedger &&
          e.ledger <= endLedger &&
          this.isCrowdfundVaultEvent(e),
      );

      allEvents.push(...eventsInRange);

      pageCursor = response.cursor || undefined;

      const lastLedger =
        response.events[response.events.length - 1]?.ledger ?? 0;
      if (
        lastLedger >= endLedger ||
        response.events.length < PAGE_LIMIT ||
        !pageCursor
      ) {
        hasMore = false;
      }
    }

    return allEvents;
  }

  /**
   * Check if an event is a crowdfund vault event
   */
  private isCrowdfundVaultEvent(event: rpc.Api.EventResponse): boolean {
    try {
      const topics = event.topic;
      if (!topics || topics.length === 0) {
        return false;
      }

      const firstTopic = topics[0];
      const topicValue = firstTopic.sym?.();

      if (!topicValue) {
        return false;
      }

      const topicStr = Buffer.isBuffer(topicValue)
        ? topicValue.toString('utf8')
        : String(topicValue);

      return (Object.values(EVENT_TOPICS) as string[]).includes(topicStr);
    } catch {
      return false;
    }
  }

  /**
   * Process a single vault event with idempotency guarantees
   */
  private async processVaultEvent(
    event: rpc.Api.EventResponse,
    vault: CrowdfundVaultProject,
  ): Promise<boolean> {
    const eventIndex = this.parseEventIndex(event.id);
    const eventType = this.extractEventType(event);

    if (!eventType) {
      this.logger.debug(`Skipping event with unknown type: ${event.id}`);
      return false;
    }

    // Idempotency check: use (txHash, eventIndex) as the primary key
    const existing = await this.eventRepo.findOne({
      where: {
        transactionHash: event.txHash,
        eventIndex,
      },
    });

    if (existing) {
      // Check if this is a replay of a processed event
      if (existing.status === CrowdfundVaultEventStatus.PROCESSED) {
        this.logger.debug(
          `Event ${event.txHash}:${eventIndex} already processed, skipping`,
        );
        return true;
      }

      // Update existing failed event
      existing.processingAttempts += 1;
      existing.status = CrowdfundVaultEventStatus.PENDING;
      await this.eventRepo.save(existing);
      return this.processEventRecord(existing, vault);
    }

    // Create new event record
    const normalizedData = this.normalizeEventData(event);
    const eventRecord = this.eventRepo.create({
      transactionHash: event.txHash,
      eventIndex,
      vaultAddress: vault.vaultAddress,
      projectId: vault.projectId,
      eventType: eventType as CrowdfundVaultEventType,
      ledgerSequence: event.ledger,
      ledgerClosedAt: new Date(event.ledgerClosedAt),
      rawPayload: {
        id: event.id,
        type: event.type,
        ledger: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt,
        txHash: event.txHash,
        topic: event.topic.map((t) => t.toXDR('base64')),
        value: event.value.toXDR('base64'),
        inSuccessfulContractCall: event.inSuccessfulContractCall,
      },
      normalizedData: normalizedData as Record<string, unknown> | undefined,
      status: CrowdfundVaultEventStatus.PENDING,
      processingAttempts: 0,
    });

    await this.eventRepo.save(eventRecord);
    return this.processEventRecord(eventRecord, vault);
  }

  /**
   * Process an event record with business logic
   */
  private async processEventRecord(
    event: CrowdfundVaultEvent,
    vault: CrowdfundVaultProject,
  ): Promise<boolean> {
    try {
      let processed = false;

      switch (event.eventType) {
        case CrowdfundVaultEventType.CONTRIBUTION:
          processed = await this.handleContribution(event, vault);
          break;
        case CrowdfundVaultEventType.MILESTONE_APPROVED:
          processed = await this.handleMilestoneApproval(event, vault);
          break;
        case CrowdfundVaultEventType.FUNDS_WITHDRAWN:
          processed = await this.handleFundsWithdrawn(event, vault);
          break;
        case CrowdfundVaultEventType.VAULT_CREATED:
          processed = await this.handleVaultCreated(event, vault);
          break;
        case CrowdfundVaultEventType.REFUND_INITIATED:
        case CrowdfundVaultEventType.REFUND_COMPLETED:
          processed = await this.handleRefundEvent(event, vault);
          break;
        default:
          this.logger.warn(`Unhandled event type: ${String(event.eventType)}`);
          processed = false;
      }

      if (processed) {
        event.status = CrowdfundVaultEventStatus.PROCESSED;
        event.processedAt = new Date();
        await this.eventRepo.save(event);
        return true;
      } else {
        // Don't mark as failed here - let the caller decide
        return false;
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      event.processingAttempts += 1;
      event.lastErrorMessage = errorMessage;
      event.lastErrorStack = errorStack;

      if (event.processingAttempts >= 3) {
        event.status = CrowdfundVaultEventStatus.FAILED;
        await this.moveToDeadLetter(event, error);
      }

      await this.eventRepo.save(event);
      throw error;
    }
  }

  /**
   * Handle contribution event
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async handleContribution(
    event: CrowdfundVaultEvent,
    vault: CrowdfundVaultProject,
  ): Promise<boolean> {
    // Implementation would update contribution records in the database
    // This is a placeholder - actual implementation would depend on your data model

    const data = event.normalizedData as NormalizedEventData | undefined;

    if (!data?.contributionData) {
      this.logger.warn(
        `Contribution event ${event.id} missing normalized data`,
      );
      return false;
    }

    this.logger.log(
      `Processing contribution: ${data.contributionData.contributor} -> ${data.contributionData.amount} to vault ${vault.vaultAddress}`,
    );

    // In a real implementation, you would:
    // 1. Upsert a contribution record
    // 2. Update project total contributions
    // 3. Check if milestone threshold is reached
    // 4. Emit events for notifications

    return true;
  }

  /**
   * Handle milestone approval event
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async handleMilestoneApproval(
    event: CrowdfundVaultEvent,
    vault: CrowdfundVaultProject,
  ): Promise<boolean> {
    const data = event.normalizedData as NormalizedEventData | undefined;

    if (!data?.milestoneData) {
      this.logger.warn(
        `Milestone approval event ${event.id} missing normalized data`,
      );
      return false;
    }

    this.logger.log(
      `Processing milestone approval: ${data.milestoneData.id} for vault ${vault.vaultAddress}`,
    );

    // In a real implementation, you would:
    // 1. Update the milestone status in the project roadmap
    // 2. Trigger fund release if applicable
    // 3. Emit events for notifications

    return true;
  }

  /**
   * Handle funds withdrawn event
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async handleFundsWithdrawn(
    event: CrowdfundVaultEvent,
    vault: CrowdfundVaultProject,
  ): Promise<boolean> {
    const data = event.normalizedData as NormalizedEventData | undefined;

    if (!data?.withdrawalData) {
      this.logger.warn(
        `Funds withdrawn event ${event.id} missing normalized data`,
      );
      return false;
    }

    this.logger.log(
      `Processing funds withdrawal: ${data.withdrawalData.amount} to ${data.withdrawalData.recipient} from vault ${vault.vaultAddress}`,
    );

    // In a real implementation, you would:
    // 1. Update the project's withdrawn amount
    // 2. Track the withdrawal for auditing
    // 3. Emit events for notifications

    return true;
  }

  /**
   * Handle vault created event
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async handleVaultCreated(
    event: CrowdfundVaultEvent,
    vault: CrowdfundVaultProject,
  ): Promise<boolean> {
    this.logger.log(`Processing vault created event for ${vault.vaultAddress}`);

    // In a real implementation, you would:
    // 1. Update the project's on-chain status
    // 2. Register the vault for future syncing
    // 3. Emit events for notifications

    return true;
  }

  /**
   * Handle refund events
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async handleRefundEvent(
    event: CrowdfundVaultEvent,
    vault: CrowdfundVaultProject,
  ): Promise<boolean> {
    this.logger.log(
      `Processing refund event ${event.eventType} for vault ${vault.vaultAddress}`,
    );

    // In a real implementation, you would:
    // 1. Track refund windows
    // 2. Process refund claims
    // 3. Update contributor balances

    return true;
  }

  /**
   * Normalize event data for efficient querying
   */
  private normalizeEventData(
    event: rpc.Api.EventResponse,
  ): NormalizedEventData | undefined {
    try {
      const topic = event.topic[0]?.sym?.();
      const topicStr = topic
        ? Buffer.isBuffer(topic)
          ? topic.toString('utf8')
          : String(topic)
        : '';

      // This is a simplified normalization - actual implementation would depend on contract event structure
      const normalized: NormalizedEventData = {};

      switch (topicStr) {
        case EVENT_TOPICS.CONTRIBUTION:
          // Parse contribution event data
          normalized.contributionData = {
            contributor: 'unknown', // Would parse from ScVal
            amount: '0',
            timestamp: event.ledger * 1000, // Approximate
          };
          break;
        case EVENT_TOPICS.MILESTONE_APPROVED:
          normalized.milestoneData = {
            id: 'unknown',
            title: 'unknown',
            approvedAt: event.ledger * 1000,
            approvedBy: 'unknown',
          };
          break;
        case EVENT_TOPICS.FUNDS_WITHDRAWN:
          normalized.withdrawalData = {
            amount: '0',
            recipient: 'unknown',
            reason: 'unknown',
            timestamp: event.ledger * 1000,
          };
          break;
      }

      return normalized;
    } catch {
      return undefined;
    }
  }

  /**
   * Parse numeric event index from event ID
   */
  private parseEventIndex(eventId: string): number {
    if (!eventId) {
      return 0;
    }
    const parts = eventId.split('-');
    const last = parts[parts.length - 1];
    const parsed = parseInt(last, 16);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Extract event type from event topics
   */
  private extractEventType(event: rpc.Api.EventResponse): string | null {
    try {
      const topics = event.topic;
      if (!topics || topics.length === 0) {
        return null;
      }
      const first = topics[0];
      const sym = first.sym?.();
      if (sym) {
        const result = Buffer.isBuffer(sym)
          ? sym.toString('utf8')
          : String(sym);
        return result;
      }
      const str = first.str?.();
      if (str) {
        return str.toString('utf8');
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch latest ledger from RPC
   */
  private async fetchLatestLedger(): Promise<number | null> {
    try {
      const server = this.rpcClient.rawServer;
      const latest = await server.getLatestLedger();
      return latest.sequence;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to fetch latest ledger from RPC: ${errorMessage}`,
      );
      return null;
    }
  }

  /**
   * Detect and handle potential reorgs
   */
  private async detectReorgs(vaultAddress: string): Promise<void> {
    // Check for events that might indicate a reorg
    // A reorg is detected when we see events with lower ledger sequences
    // after processing higher ones, or when a previously processed event
    // appears again with different data

    const latestEvents = await this.eventRepo.find({
      where: {
        vaultAddress,
        status: CrowdfundVaultEventStatus.PROCESSED,
      },
      order: {
        ledgerSequence: 'DESC',
      },
      take: 10,
    });

    if (latestEvents.length < 2) {
      return;
    }

    // Check if ledger sequence is strictly increasing
    let hasReorg = false;
    for (let i = 0; i < latestEvents.length - 1; i++) {
      if (latestEvents[i].ledgerSequence < latestEvents[i + 1].ledgerSequence) {
        // This is a reorg - lower sequence after a higher one
        hasReorg = true;
        latestEvents[i].isReorgCandidate = true;
        await this.eventRepo.save(latestEvents[i]);
      }
    }

    if (hasReorg) {
      this.logger.warn(`Potential reorg detected for vault ${vaultAddress}`);
      // Roll back to the safe ledger
      const safeLedger =
        latestEvents[latestEvents.length - 1].ledgerSequence - 1;
      const cursor = await this.cursorRepo.findOne({
        where: { vaultAddress },
      });

      if (cursor && cursor.safeLedgerSequence > safeLedger) {
        cursor.safeLedgerSequence = safeLedger;
        cursor.lastLedgerSequence = safeLedger;
        await this.cursorRepo.save(cursor);

        // Mark events after safe ledger as pending for re-processing
        await this.eventRepo.update(
          {
            vaultAddress,
            ledgerSequence: MoreThan(safeLedger),
            status: CrowdfundVaultEventStatus.PROCESSED,
          },
          {
            status: CrowdfundVaultEventStatus.PENDING,
          },
        );

        this.logger.warn(
          `Rolled back vault ${vaultAddress} to safe ledger ${safeLedger}`,
        );
      }
    }
  }

  /**
   * Move failed event to dead letter queue
   */
  private async moveToDeadLetter(
    event: CrowdfundVaultEvent,
    error: unknown,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Check if already in DLQ
    const existing = await this.deadLetterRepo.findOne({
      where: {
        transactionHash: event.transactionHash,
        eventIndex: event.eventIndex,
      },
    });

    const errorEntry = {
      timestamp: new Date().toISOString(),
      message: errorMessage,
      stack: errorStack,
    };

    if (existing) {
      existing.failureCount += 1;
      existing.lastErrorMessage = errorMessage;
      existing.lastErrorStack = errorStack;
      existing.errorHistory = [...existing.errorHistory, errorEntry];
      await this.deadLetterRepo.save(existing);
      return;
    }

    const dlqEntry = this.deadLetterRepo.create({
      eventId: event.id,
      transactionHash: event.transactionHash,
      eventIndex: event.eventIndex,
      vaultAddress: event.vaultAddress,
      eventType: event.eventType,
      ledgerSequence: event.ledgerSequence,
      rawPayload: event.rawPayload,
      failureCount: 1,
      lastErrorMessage: errorMessage,
      lastErrorStack: errorStack,
      errorHistory: [errorEntry],
      status: DeadLetterStatus.PENDING,
    });

    await this.deadLetterRepo.save(dlqEntry);
    this.logger.log(
      `Moved event ${event.transactionHash}:${event.eventIndex} to DLQ`,
    );
  }

  /**
   * List events with filtering and pagination
   */
  async listEvents(dto: ListVaultEventsDto): Promise<{
    data: VaultEventResponseDto[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }> {
    const page = dto.page ?? 0;
    const limit = dto.limit ?? 20;
    const skip = page * limit;

    const where: FindOptionsWhere<CrowdfundVaultEvent> = {};

    if (dto.vaultAddress) {
      where.vaultAddress = dto.vaultAddress;
    }

    if (dto.projectId) {
      where.projectId = dto.projectId;
    }

    if (dto.eventType) {
      where.eventType = dto.eventType;
    }

    if (dto.status) {
      where.status = dto.status;
    }

    const [data, total] = await this.eventRepo.findAndCount({
      where,
      order: {
        [dto.sortBy ?? 'createdAt']: dto.sortOrder ?? 'DESC',
      },
      skip,
      take: limit,
    });

    return {
      data: data.map((event) => this.mapEventToResponse(event)),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get dead letter queue items
   */
  async listDeadLetters(dto: DeadLetterListDto): Promise<{
    data: CrowdfundVaultDeadLetter[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }> {
    const page = dto.page ?? 0;
    const limit = dto.limit ?? 20;
    const skip = page * limit;

    const where: FindOptionsWhere<CrowdfundVaultDeadLetter> = {};

    if (dto.vaultAddress) {
      where.vaultAddress = dto.vaultAddress;
    }

    if (dto.status) {
      where.status = dto.status;
    }

    if (dto.eventType) {
      where.eventType = dto.eventType;
    }

    const [data, total] = await this.deadLetterRepo.findAndCount({
      where,
      order: {
        [dto.sortBy ?? 'createdAt']: dto.sortOrder ?? 'DESC',
      },
      skip,
      take: limit,
    });

    return {
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get dead letter statistics
   */
  async getDeadLetterStats(): Promise<DeadLetterStatsResponseDto> {
    const [total, pending, replayed, resolved] = await Promise.all([
      this.deadLetterRepo.count(),
      this.deadLetterRepo.count({
        where: { status: DeadLetterStatus.PENDING },
      }),
      this.deadLetterRepo.count({
        where: { status: DeadLetterStatus.REPLAYED },
      }),
      this.deadLetterRepo.count({
        where: { status: DeadLetterStatus.RESOLVED },
      }),
    ]);

    // Get most common error
    const mostCommonErrorResult = await this.deadLetterRepo
      .createQueryBuilder('dlq')
      .select('dlq.lastErrorMessage', 'error')
      .addSelect('COUNT(*)', 'count')
      .where('dlq.status = :status', { status: DeadLetterStatus.PENDING })
      .groupBy('dlq.lastErrorMessage')
      .orderBy('count', 'DESC')
      .limit(1)
      .getRawOne<{ error: string; count: string }>();

    const mostCommonError = mostCommonErrorResult?.error;

    // Get oldest unresolved
    const oldestResult = await this.deadLetterRepo.findOne({
      where: { status: DeadLetterStatus.PENDING },
      order: { createdAt: 'ASC' },
    });

    const byVault = await this.deadLetterRepo
      .createQueryBuilder('dlq')
      .select('dlq.vaultAddress', 'vaultAddress')
      .addSelect('COUNT(*)', 'count')
      .where('dlq.status = :status', { status: DeadLetterStatus.PENDING })
      .groupBy('dlq.vaultAddress')
      .getRawMany<{ vaultAddress: string; count: string }>();

    const byVaultObj = byVault.reduce<Record<string, number>>((acc, item) => {
      acc[item.vaultAddress] = Number(item.count);
      return acc;
    }, {});

    return {
      total,
      pending,
      replayed,
      resolved,
      mostCommonError,
      oldestUnresolvedAt: oldestResult?.createdAt,
      byVault: byVaultObj,
    };
  }

  /**
   * Inspect a dead letter entry
   */
  async inspectDeadLetter(id: string): Promise<CrowdfundVaultDeadLetter> {
    const dlq = await this.deadLetterRepo.findOne({ where: { id } });

    if (!dlq) {
      throw new NotFoundException(`Dead letter entry ${id} not found`);
    }

    return dlq;
  }

  /**
   * Replay a dead letter event
   */
  async replayDeadLetter(
    id: string,
    reason?: string,
  ): Promise<ReplayResponseDto> {
    const dlq = await this.deadLetterRepo.findOne({ where: { id } });

    if (!dlq) {
      throw new NotFoundException(`Dead letter entry ${id} not found`);
    }

    // Check if already resolved
    if (dlq.status === DeadLetterStatus.RESOLVED) {
      throw new BadRequestException(`Event ${id} is already resolved`);
    }

    // Check replay limit
    if (dlq.replayCount >= MAX_REPLAY_ATTEMPTS) {
      throw new BadRequestException(
        `Event ${id} has exceeded maximum replay attempts (${MAX_REPLAY_ATTEMPTS})`,
      );
    }

    // Check if already replayed (idempotency)
    if (dlq.status === DeadLetterStatus.REPLAYED) {
      return {
        message: 'Event already replayed successfully',
        jobId: `${dlq.transactionHash}:${dlq.eventIndex}`,
        eventId: dlq.id,
        replayCount: dlq.replayCount,
      };
    }

    // Increment replay count
    dlq.replayCount += 1;
    dlq.lastReplayedAt = new Date();

    if (reason) {
      dlq.maintainerNotes = reason;
    }

    await this.deadLetterRepo.save(dlq);

    // Try to reprocess the event
    try {
      // Find the original event or create a new one
      const existingEvent = await this.eventRepo.findOne({
        where: {
          transactionHash: dlq.transactionHash,
          eventIndex: dlq.eventIndex,
        },
      });

      if (existingEvent) {
        // Reset the event for reprocessing
        existingEvent.status = CrowdfundVaultEventStatus.PENDING;
        existingEvent.processingAttempts = 0;
        existingEvent.lastErrorMessage = undefined;
        existingEvent.lastErrorStack = undefined;
        await this.eventRepo.save(existingEvent);

        // Get the vault
        const vault = await this.projectRepo.findOne({
          where: { vaultAddress: dlq.vaultAddress },
        });

        if (vault) {
          await this.processEventRecord(existingEvent, vault);
        }
      }

      // Mark as replayed
      dlq.status = DeadLetterStatus.REPLAYED;
      await this.deadLetterRepo.save(dlq);

      return {
        message: 'Event replayed successfully',
        jobId: `${dlq.transactionHash}:${dlq.eventIndex}`,
        eventId: dlq.id,
        replayCount: dlq.replayCount,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Update DLQ with the new error
      dlq.lastErrorMessage = `Replay attempt ${dlq.replayCount} failed: ${errorMessage}`;
      dlq.errorHistory = [
        ...dlq.errorHistory,
        {
          timestamp: new Date().toISOString(),
          message: `Replay attempt ${dlq.replayCount} failed: ${errorMessage}`,
          stack: error instanceof Error ? error.stack : undefined,
        },
      ];

      // Reset status to pending for future retries
      dlq.status = DeadLetterStatus.PENDING;
      await this.deadLetterRepo.save(dlq);

      throw new Error(`Replay failed: ${errorMessage}`);
    }
  }

  /**
   * Resolve a dead letter entry
   */
  async resolveDeadLetter(
    id: string,
    reason: string,
    resolvedBy?: string,
  ): Promise<{ message: string; eventId: string }> {
    const dlq = await this.deadLetterRepo.findOne({ where: { id } });

    if (!dlq) {
      throw new NotFoundException(`Dead letter entry ${id} not found`);
    }

    if (dlq.status === DeadLetterStatus.RESOLVED) {
      return {
        message: 'Event already resolved',
        eventId: dlq.id,
      };
    }

    dlq.status = DeadLetterStatus.RESOLVED;
    dlq.resolvedAt = new Date();
    dlq.resolvedBy = resolvedBy ?? 'system';
    dlq.maintainerNotes = reason;

    await this.deadLetterRepo.save(dlq);

    return {
      message: 'Event marked as resolved',
      eventId: dlq.id,
    };
  }

  /**
   * Get sync statistics for a vault
   */
  async getVaultStats(vaultAddress: string): Promise<VaultSyncStatsDto> {
    const [cursor, totalEvents, pendingEvents, failedEvents] =
      await Promise.all([
        this.cursorRepo.findOne({ where: { vaultAddress } }),
        this.eventRepo.count({ where: { vaultAddress } }),
        this.eventRepo.count({
          where: {
            vaultAddress,
            status: CrowdfundVaultEventStatus.PENDING,
          },
        }),
        this.eventRepo.count({
          where: {
            vaultAddress,
            status: CrowdfundVaultEventStatus.FAILED,
          },
        }),
      ]);

    if (!cursor) {
      return {
        vaultAddress,
        lastLedgerSequence: 0,
        safeLedgerSequence: 0,
        totalEvents: 0,
        pendingEvents: 0,
        failedEvents: 0,
        processedEvents: 0,
        consecutiveFailures: 0,
      };
    }

    const processedEvents = totalEvents - pendingEvents - failedEvents;

    return {
      vaultAddress,
      lastLedgerSequence: cursor.lastLedgerSequence,
      safeLedgerSequence: cursor.safeLedgerSequence,
      totalEvents,
      pendingEvents,
      failedEvents,
      processedEvents,
      lastSyncedAt: cursor.lastSyncedAt,
      consecutiveFailures: cursor.consecutiveFailures,
    };
  }

  /**
   * Map event entity to response DTO
   */
  private mapEventToResponse(
    event: CrowdfundVaultEvent,
  ): VaultEventResponseDto {
    return {
      id: event.id,
      transactionHash: event.transactionHash,
      eventIndex: event.eventIndex,
      vaultAddress: event.vaultAddress,
      projectId: event.projectId,
      eventType: event.eventType,
      ledgerSequence: event.ledgerSequence,
      ledgerClosedAt: event.ledgerClosedAt,
      normalizedData: event.normalizedData,
      status: event.status,
      processingAttempts: event.processingAttempts,
      lastErrorMessage: event.lastErrorMessage,
      processedAt: event.processedAt,
      createdAt: event.createdAt,
    };
  }

  /**
   * Register a new vault for syncing
   */
  async registerVault(
    vaultAddress: string,
    projectId: string,
    contractAddress?: string,
    tokenAddress?: string,
    ownerAddress?: string,
  ): Promise<CrowdfundVaultProject> {
    const existing = await this.projectRepo.findOne({
      where: { vaultAddress },
    });

    if (existing) {
      existing.isActive = true;
      existing.projectId = projectId;
      existing.contractAddress = contractAddress ?? existing.contractAddress;
      existing.tokenAddress = tokenAddress ?? existing.tokenAddress;
      existing.ownerAddress = ownerAddress ?? existing.ownerAddress;
      return this.projectRepo.save(existing);
    }

    const vault = this.projectRepo.create({
      vaultAddress,
      projectId,
      contractAddress,
      tokenAddress,
      ownerAddress,
      isActive: true,
    });

    return this.projectRepo.save(vault);
  }
}
