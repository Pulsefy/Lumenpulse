import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { IngestSorobanEventDto } from './dto/ingest-soroban-event.dto';
import { ProjectRegistryEntity } from '../database/entities/project-registry.entity';
import { SorobanEvent } from './entities/soroban-event.entity';
import { SorobanEventArchive } from './entities/soroban-event-archive.entity';

export const SOROBAN_EVENTS_QUEUE = 'soroban-events';
export const PROCESS_EVENT_JOB = 'process-event';

// 1. We define a strict interface for your event data to satisfy ESLint
export interface ProjectEventPayload {
  projectId: string;
  owner: string;
  name: string;
  metadataCid?: string;
  ledgerSeq: number;
  txHash: string;
}

/**
 * Result shape returned by cross-boundary ledger range queries.
 * Combines records from both the hot partitioned table and cold archive.
 */
export interface LedgerRangeQueryResult {
  /** Records found in soroban_events (hot, within hot window) */
  hotCount: number;
  /** Records found in soroban_events_archive (cold, beyond hot window) */
  archiveCount: number;
  /** All matched events, sorted by ledger_sequence ASC */
  events: Array<SorobanEvent | SorobanEventArchive>;
}

@Injectable()
export class SorobanEventsService {
  private readonly logger = new Logger(SorobanEventsService.name);

  constructor(
    @InjectQueue(SOROBAN_EVENTS_QUEUE) private readonly queue: Queue,

    @InjectRepository(ProjectRegistryEntity)
    private readonly projectRepo: Repository<ProjectRegistryEntity>,

    @InjectRepository(SorobanEvent)
    private readonly eventRepo: Repository<SorobanEvent>,

    @InjectRepository(SorobanEventArchive)
    private readonly archiveRepo: Repository<SorobanEventArchive>,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async ingest(
    dto: IngestSorobanEventDto,
    requestId?: string,
  ): Promise<{ queued: boolean }> {
    const jobId = `${dto.txHash}:${dto.eventIndex}`;

    await this.queue.add(PROCESS_EVENT_JOB, dto, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 200 },
    });

    this.logger.log(
      { requestId, jobId, txHash: dto.txHash, eventIndex: dto.eventIndex },
      'Queued soroban event',
    );
    return { queued: true };
  }

  // 2. We replace 'any' with our new 'ProjectEventPayload' interface
  async syncProjectRegistryEvent(
    eventData: ProjectEventPayload,
  ): Promise<void> {
    // ESLint is now happy because it knows exactly what types these variables are
    const { projectId, owner, name, metadataCid, ledgerSeq, txHash } =
      eventData;

    const existing = await this.projectRepo.findOne({ where: { projectId } });

    if (existing && existing.lastLedgerSeq > ledgerSeq) {
      this.logger.debug(`Skipping stale event for Project ${projectId}`);
      return;
    }

    await this.projectRepo.upsert(
      {
        projectId,
        owner,
        name,
        metadataCid: metadataCid ?? existing?.metadataCid,
        lastLedgerSeq: ledgerSeq, // Traceability pointer
        lastTxHash: txHash, // Traceability pointer
      },
      ['projectId'], // Conflict target prevents duplicate rows
    );
  }

  /**
   * Find all events in a ledger range, spanning both the hot partitioned table
   * and the cold archive.
   *
   * This is the primary entry point for replay and backfill read-path queries
   * that may cross the hot-window boundary.  The indexer upsert path writes
   * directly to soroban_events (hot) and is unaffected.
   *
   * Results are ordered by ledger_sequence ASC.
   *
   * @param fromLedger  Inclusive lower bound on ledger_sequence.
   * @param toLedger    Inclusive upper bound on ledger_sequence.
   */
  async findByLedgerRange(
    fromLedger: number,
    toLedger: number,
  ): Promise<LedgerRangeQueryResult> {
    // Query both tables in parallel for efficiency
    const [hotEvents, archiveEvents] = await Promise.all([
      this.eventRepo
        .createQueryBuilder('e')
        .where('e.ledgerSequence >= :from', { from: fromLedger })
        .andWhere('e.ledgerSequence <= :to', { to: toLedger })
        .orderBy('e.ledgerSequence', 'ASC')
        .getMany(),

      this.archiveRepo
        .createQueryBuilder('a')
        .where('a.ledgerSequence >= :from', { from: fromLedger })
        .andWhere('a.ledgerSequence <= :to', { to: toLedger })
        .orderBy('a.ledgerSequence', 'ASC')
        .getMany(),
    ]);

    // Merge and sort; hot events take precedence for any duplicate ledger seq
    const combined: Array<SorobanEvent | SorobanEventArchive> = [
      ...hotEvents,
      ...archiveEvents,
    ].sort((a, b) => (a.ledgerSequence ?? 0) - (b.ledgerSequence ?? 0));

    return {
      hotCount: hotEvents.length,
      archiveCount: archiveEvents.length,
      events: combined,
    };
  }

  /**
   * Look up a single event by (txHash, eventIndex) across both tables.
   * Used by the processor for idempotency checks when a row may have been
   * archived since it was first ingested.
   */
  async findOneByTxHashAndIndex(
    txHash: string,
    eventIndex: number,
  ): Promise<SorobanEvent | SorobanEventArchive | null> {
    const hot = await this.eventRepo.findOne({
      where: { txHash, eventIndex },
      select: ['id', 'status'],
    });

    if (hot) return hot;

    return this.archiveRepo.findOne({
      where: { txHash, eventIndex },
      select: ['id', 'status'],
    });
  }
}
