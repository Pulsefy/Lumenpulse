import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContractHealthSnapshot } from './entities/contract-health-snapshot.entity';

export interface FindHistoryOptions {
  /** Maximum number of rows to return (default 50, max 200). */
  limit?: number;
  /** Skip this many rows (for simple offset pagination). */
  offset?: number;
  /** Filter by network, e.g. 'testnet' or 'mainnet'. */
  network?: string;
  /** Only return snapshots captured on or after this timestamp. */
  since?: Date;
}

@Injectable()
export class ContractHealthSnapshotRepository {
  constructor(
    @InjectRepository(ContractHealthSnapshot)
    private readonly repo: Repository<ContractHealthSnapshot>,
  ) {}

  /**
   * Persist a new snapshot row.
   */
  async save(
    snapshot: Partial<ContractHealthSnapshot>,
  ): Promise<ContractHealthSnapshot> {
    const entity = this.repo.create(snapshot);
    return this.repo.save(entity);
  }

  /**
   * Return the single most-recent snapshot, or null if none exist yet.
   */
  async findLatest(network?: string): Promise<ContractHealthSnapshot | null> {
    const qb = this.repo
      .createQueryBuilder('s')
      .orderBy('s.capturedAt', 'DESC')
      .limit(1);

    if (network) {
      qb.where('s.network = :network', { network });
    }

    return qb.getOne();
  }

  /**
   * Return a page of snapshots ordered newest-first.
   *
   * Default limit is 50; maximum is capped at 200 to guard against
   * accidental large fetches.
   */
  async findHistory(
    options: FindHistoryOptions = {},
  ): Promise<ContractHealthSnapshot[]> {
    const limit = Math.min(options.limit ?? 50, 200);
    const offset = options.offset ?? 0;

    const qb = this.repo
      .createQueryBuilder('s')
      .orderBy('s.capturedAt', 'DESC')
      .limit(limit)
      .offset(offset);

    if (options.network) {
      qb.andWhere('s.network = :network', { network: options.network });
    }

    if (options.since) {
      qb.andWhere('s.capturedAt >= :since', { since: options.since });
    }

    return qb.getMany();
  }

  /**
   * Fetch a specific snapshot by its UUID.
   * Returns null when the id does not exist.
   */
  async findById(id: string): Promise<ContractHealthSnapshot | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * Return the two most recent snapshots so the service can produce a diff
   * without a second round-trip.
   */
  async findLatestTwo(
    network?: string,
  ): Promise<[ContractHealthSnapshot | null, ContractHealthSnapshot | null]> {
    const qb = this.repo
      .createQueryBuilder('s')
      .orderBy('s.capturedAt', 'DESC')
      .limit(2);

    if (network) {
      qb.where('s.network = :network', { network });
    }

    const rows = await qb.getMany();
    return [rows[0] ?? null, rows[1] ?? null];
  }
}
