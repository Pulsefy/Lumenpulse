import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { rpc } from '@stellar/stellar-sdk';
import { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';
import { JobLockService } from '../scheduler/job-lock.service';
import { JobHistoryService } from '../scheduler/job-history.service';
import {
  SorobanEvent,
  SorobanEventStatus,
} from './entities/soroban-event.entity';
import { SorobanIndexerCursor } from './entities/soroban-indexer-cursor.entity';

const JOB_NAME = 'soroban-event-indexer';
const GLOBAL_CURSOR_KEY = '__global__';

/** Max ledgers to scan per cron tick */
const MAX_LEDGER_RANGE_PER_RUN = 1000;

/** Soroban RPC getEvents page size */
const PAGE_LIMIT = 100;

@Injectable()
export class SorobanEventIndexerService {
  private readonly logger = new Logger(SorobanEventIndexerService.name);

  constructor(
    private readonly rpcClient: SorobanRpcClientService,
    private readonly jobLock: JobLockService,
    private readonly jobHistory: JobHistoryService,
    private readonly configService: ConfigService,
    @InjectRepository(SorobanEvent)
    private readonly eventRepo: Repository<SorobanEvent>,
    @InjectRepository(SorobanIndexerCursor)
    private readonly cursorRepo: Repository<SorobanIndexerCursor>,
  ) {}

  /**
   * Incremental sync — runs every 30 seconds.
   * Picks up from the last indexed ledger and walks forward to the latest.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async runIncrementalSync(): Promise<void> {
    await this.jobLock.withLock(JOB_NAME, () => this.sync('scheduled'));
  }

  /**
   * Backfill from a specific start ledger.
   * Call this to re-index historical data from any point.
   */
  async backfill(fromLedger: number): Promise<{ indexed: number }> {
    this.logger.log(`Starting backfill from ledger ${fromLedger}`);
    return this.sync('backfill', fromLedger);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async sync(
    triggeredBy: string,
    overrideStartLedger?: number,
  ): Promise<{ indexed: number }> {
    const run = await this.jobHistory.start(JOB_NAME, triggeredBy);

    try {
      const latestLedger = await this.fetchLatestLedger();
      if (latestLedger === null) {
        await this.jobHistory.complete(run, {
          indexed: 0,
          reason: 'rpc-unavailable',
        });
        return { indexed: 0 };
      }

      const cursor = await this.getOrCreateCursor(GLOBAL_CURSOR_KEY);
      const startLedger = overrideStartLedger ?? cursor.lastLedgerSequence + 1;

      if (startLedger > latestLedger) {
        this.logger.debug(
          `Indexer up-to-date (cursor=${cursor.lastLedgerSequence}, latest=${latestLedger})`,
        );
        await this.jobHistory.complete(run, { indexed: 0, upToDate: true });
        return { indexed: 0 };
      }

      const endLedger = Math.min(
        startLedger + MAX_LEDGER_RANGE_PER_RUN - 1,
        latestLedger,
      );

      this.logger.log(
        `Indexing ledgers ${startLedger}–${endLedger} (latest=${latestLedger})`,
      );

      const indexed = await this.indexLedgerRange(startLedger, endLedger);

      // Advance cursor only after successful indexing
      await this.cursorRepo.save({
        cursorKey: GLOBAL_CURSOR_KEY,
        lastLedgerSequence: endLedger,
      });

      await this.jobHistory.complete(run, { indexed, startLedger, endLedger });

      this.logger.log(
        `Indexed ${indexed} events for ledgers ${startLedger}–${endLedger}`,
      );

      return { indexed };
    } catch (err) {
      await this.jobHistory.fail(run, err);
      this.logger.error('Soroban event indexer failed', err);
      return { indexed: 0 };
    }
  }

  /**
   * Fetch all Soroban events in [startLedger, endLedger] using cursor
   * pagination, then upsert them idempotently.
   *
   * The SDK's GetEventsRequest is a discriminated union:
   *   - ledger-range mode:  { startLedger, endLedger?, filters, limit }
   *   - cursor mode:        { cursor, filters, limit }
   * These two modes are mutually exclusive, so we build them separately.
   */
  private async indexLedgerRange(
    startLedger: number,
    endLedger: number,
  ): Promise<number> {
    const server = this.rpcClient.rawServer;
    let indexed = 0;
    let pageCursor: string | undefined;

    let hasMore = true;
    while (hasMore) {
      // Build the correct discriminated union variant
      const request: rpc.Api.GetEventsRequest = pageCursor
        ? { filters: [], cursor: pageCursor, limit: PAGE_LIMIT }
        : { filters: [], startLedger, endLedger, limit: PAGE_LIMIT };

      const response = await server.getEvents(request);

      if (!response.events || response.events.length === 0) {
        break;
      }

      // Filter to events strictly within our target ledger range
      const eventsInRange = response.events.filter(
        (e) => e.ledger >= startLedger && e.ledger <= endLedger,
      );

      await this.upsertEvents(eventsInRange);
      indexed += eventsInRange.length;

      // The SDK returns a string cursor on the response object for pagination
      pageCursor = response.cursor || undefined;

      // Stop if we've passed the end ledger or exhausted pages
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

    return indexed;
  }

  /**
   * Upsert a batch of parsed EventResponse objects into soroban_events.
   * Uses (txHash, eventIndex) as the idempotency key — duplicate rows are
   * silently ignored via the unique constraint.
   */
  private async upsertEvents(events: rpc.Api.EventResponse[]): Promise<void> {
    if (events.length === 0) return;

    const rows: DeepPartial<SorobanEvent>[] = events.map((e) => {
      // contractId is a Contract object in the parsed response; get its address
      const contractId = e.contractId?.address().toString() ?? null;
      const eventType = this.extractEventType(e);
      const eventIndex = this.parseEventIndex(e.id);

      const rawPayload: Record<string, unknown> = {
        id: e.id,
        type: e.type,
        ledger: e.ledger,
        ledgerClosedAt: e.ledgerClosedAt,
        txHash: e.txHash,
        // Store topic and value as base64 strings for portability
        topic: e.topic.map((t) => t.toXDR('base64')),
        value: e.value.toXDR('base64'),
        inSuccessfulContractCall: e.inSuccessfulContractCall,
      };

      return {
        txHash: e.txHash,
        eventIndex,
        contractId,
        eventType,
        ledgerSequence: e.ledger,
        rawPayload,
        status: SorobanEventStatus.PENDING,
        errorMessage: null,
        processedAt: null,
      };
    });

    // upsert: on conflict (tx_hash, event_index) do nothing — fully idempotent

    await this.eventRepo.upsert(rows as any[], {
      conflictPaths: ['txHash', 'eventIndex'],
      skipUpdateIfNoValuesChanged: true,
    });
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

  private async getOrCreateCursor(key: string): Promise<SorobanIndexerCursor> {
    const existing = await this.cursorRepo.findOne({
      where: { cursorKey: key },
    });
    if (existing) return existing;

    const bootstrapLedger = this.configService.get<number>(
      'SOROBAN_INDEXER_START_LEDGER',
      0,
    );

    const newCursor = this.cursorRepo.create({
      cursorKey: key,
      lastLedgerSequence: bootstrapLedger,
    });
    return this.cursorRepo.save(newCursor);
  }

  /**
   * Parse the numeric event index from a Soroban event ID string.
   * Format: "{ledger_hex}-{index_hex}", e.g. "0000000012345678-0000000001"
   */
  private parseEventIndex(eventId: string): number {
    if (!eventId) return 0;
    const parts = eventId.split('-');
    const last = parts[parts.length - 1];
    const parsed = parseInt(last, 16);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Extract a human-readable event type from the first topic ScVal.
   * Soroban contracts conventionally use a Symbol as the first topic.
   */
  private extractEventType(e: rpc.Api.EventResponse): string | null {
    try {
      const topics = e.topic;
      if (!topics || topics.length === 0) return null;
      const first = topics[0];
      // xdr.ScVal — try to extract a symbol or string arm
      const sym = first.sym?.();
      if (sym) return Buffer.isBuffer(sym) ? sym.toString('utf8') : String(sym);
      const str = first.str?.();
      if (str) return str.toString('utf8');
      return null;
    } catch {
      return null;
    }
  }
}
