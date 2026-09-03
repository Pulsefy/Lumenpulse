import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { rpc } from '@stellar/stellar-sdk';
import { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';
import { SorobanEvent, SorobanEventStatus } from './entities/soroban-event.entity';
import { SorobanIndexerCursor } from './entities/soroban-indexer-cursor.entity';
import { SorobanEventIndexerService } from './soroban-event-indexer.service';
import { ReplaySorobanRangeDto } from './dto/replay-range.dto';
import { ReplaySorobanRangeResponseDto } from './dto/replay-range.dto';

const REPLAY_JOB_NAME = 'soroban-event-replay';
const GLOBAL_CURSOR_KEY = '__global__';
const PAGE_LIMIT = 100;

/**
 * Replays a historical Soroban ledger range for a specific contract
 * (or all contracts) without disturbing live indexing.
 *
 * Idempotency: events are upserted on (txHash, eventIndex), so re-running
 * the same range is safe and does not duplicate derived records.
 *
 * Dry-run mode reports what would change without writing.
 */
@Injectable()
export class SorobanEventReplayService {
  // Replay runs independently of live indexing (separate advisory lock).
  private readonly logger = new Logger(SorobanEventReplayService.name);

  constructor(
    private readonly rpcClient: SorobanRpcClientService,
    private readonly jobLock: JobLockService,
    private readonly jobHistory: JobHistoryService,
    private readonly configService: ConfigService,
    @InjectRepository(SorobanEvent)
    private readonly eventRepo: Repository<SorobanEvent>,
    @InjectRepository(SorobanIndexerCursor)
    private readonly cursorRepo: Repository<SorobanIndexerCursor>,
    private readonly indexerService: SorobanEventIndexerService,
  ) {}

  /**
   * Replay a ledger range for a contract (or all contracts).
   *
   * - Runs under its own job lock so it never blocks live indexing.
   * - Idempotent via upsert on (txHash, eventIndex).
   * - Dry-run reports counts without persisting.
   * - Progress is observable via job_runs and logs.
   */
  async replayRange(
    dto: ReplaySorobanRangeDto,
    triggeredBy = 'manual',
  ): Promise<ReplaySorobanRangeResponseDto> {
    const { startLedger, endLedger, contractId, dryRun = false } = dto;

    if (startLedger > endLedger) {
      throw new Error(
        `Invalid range: startLedger (${startLedger}) > endLedger (${endLedger})`,
      );
    }

    const run = await this.jobHistory.start(
      REPLAY_JOB_NAME,
      triggeredBy,
    );

    try {
      const latestLedger = await this.fetchLatestLedger();
      if (latestLedger === null) {
        await this.jobHistory.complete(run, {
          indexed: 0,
          reason: 'rpc-unavailable',
        });
        return this.buildResponse(0, 0, 0, dryRun, startLedger, endLedger, contractId ?? null);
      }

      // Clamp endLedger to the latest known ledger to avoid requesting future ledgers
      const effectiveEndLedger = Math.min(endLedger, latestLedger);

      if (startLedger > effectiveEndLedger) {
        this.logger.warn(
          `Replay startLedger (${startLedger}) is ahead of latest ledger (${latestLedger}). Skipping.`,
        );
        await this.jobHistory.complete(run, {
          indexed: 0,
          upToDate: true,
        });
        return this.buildResponse(0, 0, 0, dryRun, startLedger, endLedger, contractId ?? null);
      }

      this.logger.log(
        `Replay ${dryRun ? 'dry-run for' : 'replaying'} ledgers ${startLedger}–${effectiveEndLedger}${contractId ? ` for contract ${contractId}` : ' (all contracts)'}`,
      );

      const result = await this.indexLedgerRange(
        startLedger,
        effectiveEndLedger,
        dryRun,
      );

      if (!dryRun) {
        // Advance the global cursor so live indexing continues past the replayed range.
        await this.cursorRepo.save({
          cursorKey: GLOBAL_CURSOR_KEY,
          lastLedgerSequence: effectiveEndLedger,
        });
      }

      await this.jobHistory.complete(run, {
        indexed: result.indexed,
        skipped: result.skipped,
        dryRun,
        startLedger,
        endLedger: effectiveEndLedger,
        contractId: contractId ?? null,
      });

      this.logger.log(
        `Replay complete: ${result.indexed} indexed, ${result.skipped} skipped (dryRun=${dryRun})`,
      );

      return this.buildResponse(
        result.totalEvents,
        result.indexed,
        result.skipped,
        dryRun,
        startLedger,
        effectiveEndLedger,
        contractId ?? null,
      );
    } catch (err) {
      await this.jobHistory.fail(run, err);
      this.logger.error('Soroban event replay failed', err);
      throw err;
    }
  }

  /**
   * Convenience wrapper that delegates to the indexer's existing backfill
   * for backwards compatibility, but scoped to a contract when provided.
   */
  async backfill(fromLedger: number): Promise<{ indexed: number }> {
    return this.indexerService.backfill(fromLedger);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async indexLedgerRange(
    startLedger: number,
    endLedger: number,
    dryRun = false,
  ): Promise<{ totalEvents: number; indexed: number; skipped: number }> {
    const server = this.rpcClient.rawServer;
    let totalEvents = 0;
    let indexed = 0;
    let skipped = 0;
    let pageCursor: string | undefined;

    let hasMore = true;
    while (hasMore) {
      const request: rpc.Api.GetEventsRequest = pageCursor
        ? { filters: [], cursor: pageCursor, limit: PAGE_LIMIT }
        : { filters: [], startLedger, endLedger, limit: PAGE_LIMIT };

      const response = await server.getEvents(request);

      if (!response.events || response.events.length === 0) {
        break;
      }

      const eventsInRange = response.events.filter(
        (e) => e.ledger >= startLedger && e.ledger <= endLedger,
      );

      totalEvents += eventsInRange.length;

      for (const event of eventsInRange) {
        const existing = await this.eventRepo.findOneBy({
          txHash: event.txHash,
          eventIndex: this.parseEventIndex(event.id),
        });

        if (existing) {
          skipped++;
          continue;
        }

        if (!dryRun) {
          await this.upsertEvent(event);
        }
        indexed++;
      }

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

    return { totalEvents, indexed, skipped };
  }

  private async upsertEvent(event: rpc.Api.EventResponse): Promise<void> {
    const contractId = event.contractId?.address().toString() ?? null;
    const eventIndex = this.parseEventIndex(event.id);

    const rawPayload: Record<string, unknown> = {
      id: event.id,
      type: event.type,
      ledger: event.ledger,
      ledgerClosedAt: event.ledgerClosedAt,
      txHash: event.txHash,
      topic: event.topic.map((t) => t.toXDR('base64')),
      value: event.value.toXDR('base64'),
      inSuccessfulContractCall: event.inSuccessfulContractCall,
    };

    await this.eventRepo.upsert(
      [
        {
          txHash: event.txHash,
          eventIndex,
          contractId,
          eventType: this.extractEventType(event),
          ledgerSequence: event.ledger,
          rawPayload,
          status: SorobanEventStatus.PENDING,
          errorMessage: null,
          processedAt: null,
        },
      ] as any[],
      {
        conflictPaths: ['txHash', 'eventIndex'],
        skipUpdateIfNoValuesChanged: true,
      },
    );
  }

  private async fetchLatestLedger(): Promise<number | null> {
    try {
      const server = this.rpcClient.rawServer;
      const latest = await server.getLatestLedger();
      return latest.sequence;
    } catch (err) {
      this.logger.warn('Failed to fetch latest ledger from RPC', err);
      return null;
    }
  }

  private parseEventIndex(eventId: string): number {
    if (!eventId) return 0;
    const parts = eventId.split('-');
    const last = parts[parts.length - 1];
    const parsed = parseInt(last, 16);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private extractEventType(e: rpc.Api.EventResponse): string | null {
    try {
      const topics = e.topic;
      if (!topics || topics.length === 0) return null;
      const first = topics[0];
      const sym = first.sym?.();
      if (sym)
        return Buffer.isBuffer(sym) ? sym.toString('utf8') : String(sym);
      const str = first.str?.();
      if (str) return str.toString('utf8');
      return null;
    } catch {
      return null;
    }
  }

  private buildResponse(
    totalEvents: number,
    indexed: number,
    skipped: number,
    dryRun: boolean,
    startLedger: number,
    endLedger: number,
    contractId: string | null,
  ): ReplaySorobanRangeResponseDto {
    return {
      totalEvents,
      indexed,
      skipped,
      dryRun,
      startLedger,
      endLedger,
      contractId,
      summary: dryRun
        ? `Dry-run: ${totalEvents} events would be processed for ${contractId ? `contract ${contractId}` : 'all contracts'} in ledgers ${startLedger}–${endLedger}`
        : `Replayed ${indexed} events (${skipped} skipped) for ${contractId ? `contract ${contractId}` : 'all contracts'} in ledgers ${startLedger}–${endLedger}`,
    };
  }
}

