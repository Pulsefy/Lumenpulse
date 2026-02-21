import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PortfolioSnapshot } from './entities/portfolio-snapshot.entity';
import { PortfolioAsset } from './portfolio-asset.entity';
import { User } from '../users/entities/user.entity';
import { StellarBalanceService } from './stellar-balance.service';
import {
  PortfolioHistoryResponseDto,
  PortfolioSnapshotDto,
} from './dto/portfolio-snapshot.dto';
import { PortfolioPerformanceResponseDto } from './dto/portfolio-performance.dto';
import { calculatePortfolioPerformance } from './utils/portfolio-performance.utils';

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    @InjectRepository(PortfolioSnapshot)
    private readonly snapshotRepository: Repository<PortfolioSnapshot>,
    @InjectRepository(PortfolioAsset)
    private readonly assetRepository: Repository<PortfolioAsset>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly stellarBalanceService: StellarBalanceService,
  ) {}

  /**
   * Create a snapshot for a specific user
   */
  async createSnapshot(userId: string): Promise<PortfolioSnapshot> {
    this.logger.log(`Creating snapshot for user ${userId}`);

    // Get user to access their Stellar public key
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    // Fetch balances from Stellar network using user's public key (id)
    let assetBalances: Array<{
      assetCode: string;
      assetIssuer: string | null;
      amount: string;
      valueUsd: number;
    }> = [];
    let totalValueUsd = 0;

    try {
      const stellarBalances =
        await this.stellarBalanceService.getAccountBalances(user.id);

      // Calculate USD values for each asset
      assetBalances = stellarBalances.map((balance) => {
        const valueUsd = this.stellarBalanceService.getAssetValueUsd(
          balance.assetCode,
          balance.assetIssuer,
          balance.balance,
        );

        totalValueUsd += valueUsd;

        return {
          assetCode: balance.assetCode,
          assetIssuer: balance.assetIssuer,
          amount: balance.balance,
          valueUsd,
        };
      });
    } catch {
      this.logger.warn(
        `Failed to fetch Stellar balances for user ${userId}, using portfolio assets as fallback`,
      );

      // Fallback to portfolio_assets table if Stellar fetch fails
      const portfolioAssets = await this.assetRepository.find({
        where: { userId },
      });

      assetBalances = portfolioAssets.map((asset) => {
        const valueUsd = this.stellarBalanceService.getAssetValueUsd(
          asset.assetCode,
          asset.assetIssuer,
          asset.amount,
        );

        totalValueUsd += valueUsd;

        return {
          assetCode: asset.assetCode,
          assetIssuer: asset.assetIssuer,
          amount: asset.amount,
          valueUsd,
        };
      });
    }

    // Create and save snapshot
    const snapshot = this.snapshotRepository.create({
      userId,
      assetBalances,
      totalValueUsd: totalValueUsd.toFixed(2),
    });

    return await this.snapshotRepository.save(snapshot);
  }

  /**
   * Get portfolio history for a user with pagination
   */
  async getPortfolioHistory(
    userId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<PortfolioHistoryResponseDto> {
    const skip = (page - 1) * limit;

    const [snapshots, total] = await this.snapshotRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    const snapshotDtos: PortfolioSnapshotDto[] = snapshots.map((snapshot) => ({
      id: snapshot.id,
      userId: snapshot.userId,
      createdAt: snapshot.createdAt,
      assetBalances: snapshot.assetBalances,
      totalValueUsd: snapshot.totalValueUsd,
    }));

    return {
      snapshots: snapshotDtos,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Scheduled job to create snapshots for all users
   * Runs daily at midnight
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async createSnapshotsForAllUsers(): Promise<void> {
    this.logger.log('Starting scheduled snapshot creation for all users');

    const users = await this.userRepository.find();
    let successCount = 0;
    let failCount = 0;

    for (const user of users) {
      try {
        await this.createSnapshot(user.id);
        successCount++;
      } catch (error: unknown) {
        this.logger.error(
          `Failed to create snapshot for user ${user.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        failCount++;
      }
    }

    this.logger.log(
      `Snapshot creation completed. Success: ${successCount}, Failed: ${failCount}`,
    );
  }

  /**
   * Manual trigger for creating snapshots (useful for testing)
   */
  async triggerSnapshotCreation(): Promise<{
    success: number;
    failed: number;
  }> {
    this.logger.log('Manual snapshot creation triggered');

    const users = await this.userRepository.find();
    let successCount = 0;
    let failCount = 0;

    for (const user of users) {
      try {
        await this.createSnapshot(user.id);
        successCount++;
      } catch (error: unknown) {
        this.logger.error(
          `Failed to create snapshot for user ${user.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        failCount++;
      }
    }

    return { success: successCount, failed: failCount };
  }

  /**
   * Get portfolio performance metrics for a user
   * Calculates 24h, 7d, and 30d performance based on historical snapshots
   */
  async getPortfolioPerformance(
    userId: string,
  ): Promise<PortfolioPerformanceResponseDto> {
    this.logger.log(`Calculating portfolio performance for user ${userId}`);

    // Get user to access their Stellar public key
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    // Get current portfolio value by creating a fresh snapshot
    const currentSnapshot = await this.createSnapshot(userId);
    const currentValueUsd = parseFloat(currentSnapshot.totalValueUsd);

    // Get all historical snapshots for the user (last 30 days worth)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const historicalSnapshots = await this.snapshotRepository.find({
      where: {
        userId,
        createdAt: {
          $gte: thirtyDaysAgo,
        } as unknown as Date,
      },
      order: { createdAt: 'DESC' },
    });

    // Calculate performance using pure function
    return calculatePortfolioPerformance(
      userId,
      currentValueUsd,
      historicalSnapshots,
    );
  }
}
