import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PortfolioMaterializedSnapshot } from './entities/portfolio-materialized-snapshot.entity';
import { PortfolioSnapshot } from './entities/portfolio-snapshot.entity';

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

  constructor(
    @InjectRepository(PortfolioMaterializedSnapshot)
    private readonly materializedRepo: Repository<PortfolioMaterializedSnapshot>,
    @InjectRepository(PortfolioSnapshot)
    private readonly snapshotRepo: Repository<PortfolioSnapshot>,
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

    const existing = await this.materializedRepo.findOne({
      where: { userId: data.userId },
    });

    if (existing) {
      existing.totalValueUsd = data.totalValueUsd;
      existing.assetBalances = data.assetBalances;
      existing.assetAllocation =
        data.assetAllocation ?? existing.assetAllocation;
      existing.hasLinkedAccount = data.hasLinkedAccount;
      existing.sourceSnapshotId = data.sourceSnapshotId;
      return this.materializedRepo.save(existing);
    }

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
    return this.materializedRepo.findOne({
      where: { userId },
    });
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

    const allocation = this.computeAllocation(latestSnapshot.assetBalances);

    await this.upsertForUser({
      userId,
      totalValueUsd: latestSnapshot.totalValueUsd,
      assetBalances: latestSnapshot.assetBalances,
      assetAllocation: allocation,
      hasLinkedAccount: true, // If they have a snapshot they had a linked account
      sourceSnapshotId: latestSnapshot.id,
    });

    return true;
  }

  /**
   * Delete the materialized snapshot for a user.
   * Used when a user is deleted or when a forced recompute is needed.
   */
  async deleteForUser(userId: string): Promise<void> {
    await this.materializedRepo.delete({ userId });
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
