import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PortfolioMaterializedSnapshot } from './entities/portfolio-materialized-snapshot.entity';
import { PortfolioSnapshot } from './entities/portfolio-snapshot.entity';
import { StellarAccount } from '../users/entities/stellar-account.entity';
import { CACHE_NAMES } from '../cache/cache.constants';
import { MetricsService } from '../metrics/metrics.service';

export interface MaterializedSnapshotData {
  userId: string;
  totalValueUsd: string;
  assetBalances: {
    assetCode: string;
    assetIssuer: string | null;
    amount: string;
    valueUsd: number;
  }[];
  assetAllocation?:
    | {
        assetCode: string;
        assetIssuer: string | null;
        amount: string;
        valueUsd: number;
        percentage: number;
      }[]
    | null;
  hasLinkedAccount: boolean;
  sourceSnapshotId: string;
}

@Injectable()
export class MaterializedSnapshotService {
  private readonly logger = new Logger(MaterializedSnapshotService.name);
  private readonly generations = new Map<string, number>();
  private readonly maxTrackedGenerations = 10_000;

  constructor(
    @InjectRepository(PortfolioMaterializedSnapshot)
    private readonly materializedRepo: Repository<PortfolioMaterializedSnapshot>,
    @InjectRepository(PortfolioSnapshot)
    private readonly snapshotRepo: Repository<PortfolioSnapshot>,
    @Optional()
    @InjectRepository(StellarAccount)
    private readonly stellarAccountRepo?: Repository<StellarAccount>,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

  /**
   * Upsert a materialized snapshot for a user.
   *
   * Uses the unique constraint on userId so that re-running always
   * updates the single existing row rather than creating duplicates.
   */
  async upsertForUser(
    data: MaterializedSnapshotData,
  ): Promise<PortfolioMaterializedSnapshot> {
    this.logger.debug(
      `Upserting materialized snapshot for user ${data.userId}`,
    );
    this.advanceGeneration(data.userId);

    try {
      const existing = await this.materializedRepo.findOne({
        where: { userId: data.userId },
      });

      const saved = existing
        ? await this.updateExisting(existing, data)
        : await this.createNew(data);
      // Advance again after the database write so reads that began during the
      // write cannot cache the pre-write row under the first generation.
      this.advanceGeneration(data.userId);
      this.markCacheFresh();
      this.recordCacheInvalidation('success');
      return saved;
    } catch (error) {
      this.recordCacheInvalidation('error');
      throw error;
    }
  }

  private async updateExisting(
    existing: PortfolioMaterializedSnapshot,
    data: MaterializedSnapshotData,
  ): Promise<PortfolioMaterializedSnapshot> {
    existing.totalValueUsd = data.totalValueUsd;
    existing.assetBalances = data.assetBalances;
    existing.assetAllocation = data.assetAllocation ?? existing.assetAllocation;
    existing.hasLinkedAccount = data.hasLinkedAccount;
    existing.sourceSnapshotId = data.sourceSnapshotId;
    return this.materializedRepo.save(existing);
  }

  private async createNew(
    data: MaterializedSnapshotData,
  ): Promise<PortfolioMaterializedSnapshot> {
    const materialized = this.materializedRepo.create({
      userId: data.userId,
      totalValueUsd: data.totalValueUsd,
      assetBalances: data.assetBalances,
      assetAllocation: data.assetAllocation ?? null,
      hasLinkedAccount: data.hasLinkedAccount,
      sourceSnapshotId: data.sourceSnapshotId,
    });
    return this.materializedRepo.save(materialized);
  }

  /**
   * Fast-read path: fetch the materialized snapshot for a user.
   *
   * Returns null when no materialized row exists — the caller should
   * fall back to computing from raw data in that case.
   */
  async getForUser(
    userId: string,
  ): Promise<PortfolioMaterializedSnapshot | null> {
    // Retry once when a same-user upsert/delete overlaps the database read.
    // This closes the common read-after-write window without turning the
    // materialized row into an in-memory cache.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const generation = this.getGeneration(userId);
      const row = await this.materializedRepo.findOne({ where: { userId } });
      if (generation !== this.getGeneration(userId)) continue;
      this.recordRead(row, row?.updatedAt);
      return row;
    }

    const row = await this.materializedRepo.findOne({ where: { userId } });
    this.recordRead(row, row?.updatedAt);
    return row;
  }

  /**
   * Refresh the materialized snapshot for a single user by looking up
   * their latest portfolio snapshot and re-computing allocation data.
   *
   * Returns true if a row was updated/created, false if the user has
   * no snapshots at all.
   */
  async refreshForUser(userId: string): Promise<boolean> {
    const latestSnapshot = await this.snapshotRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    if (!latestSnapshot) {
      this.logger.debug(
        `No snapshot found for user ${userId} — skipping refresh`,
      );
      return false;
    }

    const hasLinkedAccount = this.stellarAccountRepo
      ? (await this.stellarAccountRepo.count({
          where: { userId, isActive: true },
        })) > 0
      : true;

    if (!hasLinkedAccount) {
      await this.deleteForUser(userId);
      return true;
    }

    const allocation = this.computeAllocation(latestSnapshot.assetBalances);

    await this.upsertForUser({
      userId,
      totalValueUsd: latestSnapshot.totalValueUsd,
      assetBalances: latestSnapshot.assetBalances,
      assetAllocation: allocation,
      hasLinkedAccount,
      sourceSnapshotId: latestSnapshot.id,
    });

    return true;
  }

  /**
   * Delete the materialized snapshot for a user.
   * Used when a user is deleted or when a forced recompute is needed.
   */
  async deleteForUser(userId: string): Promise<void> {
    this.advanceGeneration(userId);
    try {
      await this.materializedRepo.delete({ userId });
      this.advanceGeneration(userId);
      this.markCacheFresh();
      this.recordCacheInvalidation('success');
    } catch (error) {
      this.recordCacheInvalidation('error');
      throw error;
    }
  }

  private getGeneration(userId: string): number {
    return this.generations.get(userId) ?? 0;
  }

  private advanceGeneration(userId: string): void {
    const nextGeneration = this.getGeneration(userId) + 1;
    this.generations.delete(userId);
    this.generations.set(userId, nextGeneration);
    while (this.generations.size > this.maxTrackedGenerations) {
      const oldest = this.generations.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.generations.delete(oldest);
    }
  }

  private recordRead(
    row: PortfolioMaterializedSnapshot | null,
    updatedAt?: Date,
  ): void {
    if (!this.metricsService) return;
    const updatedAtMs = updatedAt ? new Date(updatedAt).getTime() : Number.NaN;
    const staleness = Number.isFinite(updatedAtMs)
      ? Math.max(0, (Date.now() - updatedAtMs) / 1_000)
      : 0;
    this.safeMetrics(() =>
      this.metricsService?.recordCacheRead(
        CACHE_NAMES.PORTFOLIO_MATERIALIZED,
        row ? 'hit' : 'miss',
        staleness,
      ),
    );
  }

  private markCacheFresh(): void {
    this.safeMetrics(() =>
      this.metricsService?.setCacheStaleness(
        CACHE_NAMES.PORTFOLIO_MATERIALIZED,
        0,
      ),
    );
  }

  private recordCacheInvalidation(result: 'success' | 'error'): void {
    this.safeMetrics(() =>
      this.metricsService?.recordCacheInvalidation(
        CACHE_NAMES.PORTFOLIO_MATERIALIZED,
        result,
      ),
    );
  }

  private safeMetrics(action: () => void): void {
    try {
      action();
    } catch {
      // Telemetry must not make the materialized read model unavailable.
    }
  }

  /**
   * Compute asset allocation with percentages from asset balances.
   */
  computeAllocation(
    assetBalances: {
      assetCode: string;
      assetIssuer: string | null;
      amount: string;
      valueUsd: number;
    }[],
  ): {
    assetCode: string;
    assetIssuer: string | null;
    amount: string;
    valueUsd: number;
    percentage: number;
  }[] {
    const totalValueUsd = assetBalances.reduce((sum, a) => sum + a.valueUsd, 0);

    return assetBalances.map((asset) => ({
      assetCode: asset.assetCode,
      assetIssuer: asset.assetIssuer,
      amount: asset.amount,
      valueUsd: asset.valueUsd,
      percentage:
        totalValueUsd > 0 ? (asset.valueUsd / totalValueUsd) * 100 : 0,
    }));
  }
}
