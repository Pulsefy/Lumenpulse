import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SorobanEvent } from './entities/soroban-event.entity';
import { SorobanEventArchive } from './entities/soroban-event-archive.entity';
import { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';
import {
  SorobanArchivePolicy,
  buildSorobanArchivePolicy,
  hotWindowCutoff,
  createdAtCutoff,
} from './soroban-archive.policy';

export interface SorobanArchiveRunResult {
  latestLedger: number | null;
  cutoffLedger: number | null;
  createdAtCutoff: string | null;
  archived: number;
  batches: number;
  skippedReason?: string;
}

@Injectable()
export class SorobanArchiveService {
  private readonly logger = new Logger(SorobanArchiveService.name);
  private readonly policy: SorobanArchivePolicy = buildSorobanArchivePolicy();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly rpcClient: SorobanRpcClientService,
  ) {}

  getPolicy(): SorobanArchivePolicy {
    return this.policy;
  }

  /**
   * Move one run's worth of expired rows from `soroban_events` to
   * `soroban_events_archive`. Each batch is copied and deleted in a single
   * transaction, so a row is never lost or duplicated between the archive
   * insert and the hot delete.
   *
   * Idempotent: `ON CONFLICT (txHash, eventIndex) DO NOTHING` on the
   * archive side, so re-running after a partial failure is safe.
   */
  async run(now = new Date()): Promise<SorobanArchiveRunResult> {
    if (!this.policy.enabled) {
      return {
        latestLedger: null,
        cutoffLedger: null,
        createdAtCutoff: null,
        archived: 0,
        batches: 0,
        skippedReason: 'disabled',
      };
    }

    const latestLedger = await this.fetchLatestLedger();
    if (latestLedger === null) {
      return {
        latestLedger: null,
        cutoffLedger: null,
        createdAtCutoff: null,
        archived: 0,
        batches: 0,
        skippedReason: 'rpc-unavailable',
      };
    }

    const cutoffLedger = hotWindowCutoff(
      latestLedger,
      this.policy.hotWindowLedgers,
    );
    const createdCutoff = createdAtCutoff(now, this.policy.retentionDays);

    let totalArchived = 0;
    let batches = 0;

    for (let b = 0; b < this.policy.maxBatchesPerRun; b++) {
      const moved = await this.archiveOneBatch(cutoffLedger, createdCutoff);
      batches++;
      totalArchived += moved;
      if (moved < this.policy.batchSize) break;
    }

    if (totalArchived > 0) {
      this.logger.log(
        `Archived ${totalArchived} soroban_events row(s) ` +
          `(ledgerSequence < ${cutoffLedger}` +
          (createdCutoff ? `, createdAt < ${createdCutoff.toISOString()}` : '') +
          `) in ${batches} batch(es)`,
      );
    }

    return {
      latestLedger,
      cutoffLedger,
      createdAtCutoff: createdCutoff ? createdCutoff.toISOString() : null,
      archived: totalArchived,
      batches,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async archiveOneBatch(
    cutoffLedger: number,
    createdCutoff: Date | null,
  ): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const eventRepo = manager.getRepository(SorobanEvent);
      const archiveRepo = manager.getRepository(SorobanEventArchive);

      const qb = eventRepo
        .createQueryBuilder('e')
        .where('e.ledgerSequence IS NOT NULL')
        .andWhere('e.ledgerSequence < :cutoffLedger', { cutoffLedger })
        .orderBy('e.ledgerSequence', 'ASC')
        .addOrderBy('e.createdAt', 'ASC')
        .take(this.policy.batchSize);

      if (createdCutoff) {
        qb.andWhere('e.createdAt < :createdCutoff', { createdCutoff });
      }

      const rows = await qb.getMany();
      if (rows.length === 0) return 0;

      const archiveRows = rows.map((row) =>
        archiveRepo.create({
          originalId: row.id,
          txHash: row.txHash,
          eventIndex: row.eventIndex,
          contractId: row.contractId,
          eventType: row.eventType,
          canonicalType: row.canonicalType,
          category: row.category,
          rawPayload: row.rawPayload,
          ledgerSequence: row.ledgerSequence,
          status: row.status,
          errorMessage: row.errorMessage,
          createdAt: row.createdAt,
          processedAt: row.processedAt,
        }),
      );

      // Append-only; conflict = already archived by a previous partial run.
      await archiveRepo
        .createQueryBuilder()
        .insert()
        .into(SorobanEventArchive)
        .values(archiveRows)
        .orIgnore()
        .execute();

      // Only delete rows whose (txHash, eventIndex) is now present in archive.
      const ids = rows.map((r) => r.id);
      await eventRepo
        .createQueryBuilder()
        .delete()
        .from(SorobanEvent)
        .whereInIds(ids)
        .execute();

      return rows.length;
    });
  }

  private async fetchLatestLedger(): Promise<number | null> {
    try {
      const latest = await this.rpcClient.rawServer.getLatestLedger();
      return latest.sequence;
    } catch (err) {
      this.logger.warn(
        `Failed to fetch latest ledger for archival: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
