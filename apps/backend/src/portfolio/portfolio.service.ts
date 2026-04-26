import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PortfolioSnapshot } from './entities/portfolio-snapshot.entity';
import { PortfolioAsset } from './portfolio-asset.entity';
import { User } from '../users/entities/user.entity';
import { StellarBalanceService } from './stellar-balance.service';
import { StellarService } from '../stellar/stellar.service';
import { PriceService } from '../price/price.service';
import {
  PortfolioHistoryResponseDto,
  PortfolioSnapshotDto,
  PortfolioSummaryResponseDto,
} from './dto/portfolio-snapshot.dto';
import {
  PortfolioSummaryWithCurrencyResponseDto,
  AssetBalanceWithCurrencyDto,
  CurrencyCode,
} from './dto/portfolio-currency.dto';
import { PortfolioPerformanceResponseDto } from './dto/portfolio-performance.dto';
import { calculatePortfolioPerformance } from './utils/portfolio-performance.utils';
import { PortfolioSnapshotQueueService } from './queue/portfolio-snapshot.queue.service';
import { PortfolioSnapshotBatchStatus } from './queue/portfolio-snapshot.types';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { QueryProfilerService } from '../common/profiling/query-profiler.service';

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
    private readonly exchangeRatesService: ExchangeRatesService,
    private readonly stellarService: StellarService,
    private readonly priceService: PriceService,
    private readonly snapshotQueueService: PortfolioSnapshotQueueService,
    private readonly profiler: QueryProfilerService,
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
      assetBalances = await Promise.all(
        stellarBalances.map(async (balance) => {
          const price = await this.priceService.getCurrentPrice(
            balance.assetCode,
          );
          const valueUsd = parseFloat(balance.balance) * price;

          totalValueUsd += valueUsd;

          return {
            assetCode: balance.assetCode,
            assetIssuer: balance.assetIssuer,
            amount: balance.balance,
            valueUsd,
          };
        }),
      );
    } catch {
      this.logger.warn(
        `Failed to fetch Stellar balances for user ${userId}, using portfolio assets as fallback`,
      );

      // Fallback to portfolio_assets table if Stellar fetch fails
      const portfolioAssets = await this.assetRepository.find({
        where: { userId },
      });

      assetBalances = await Promise.all(
        portfolioAssets.map(async (asset) => {
          const price = await this.priceService.getCurrentPrice(
            asset.assetCode,
          );
          const valueUsd = parseFloat(asset.amount) * price;

          totalValueUsd += valueUsd;

          return {
            assetCode: asset.assetCode,
            assetIssuer: asset.assetIssuer,
            amount: asset.amount,
            valueUsd,
          };
        }),
      );
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

    const [snapshots, total] = await this.profiler.profile(
      () =>
        this.snapshotRepository.findAndCount({
          where: { userId },
          order: { createdAt: 'DESC' },
          skip,
          take: limit,
        }),
      { label: 'PortfolioService.getPortfolioHistory', thresholdMs: 150 },
    );

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
   * Get portfolio summary (latest snapshot) for the mobile dashboard
   * Returns total USD value and individual asset balances
   */
  async getPortfolioSummary(
    userId: string,
  ): Promise<PortfolioSummaryResponseDto> {
    this.logger.log(`Fetching portfolio summary for user ${userId}`);

    return this.profiler.profile(
      async () => {
        // Check if user has any linked Stellar accounts
        const user = await this.userRepository.findOne({
          where: { id: userId },
          relations: ['stellarAccounts'],
        });

        const hasLinkedAccount =
          user?.stellarAccounts && user.stellarAccounts.length > 0;

        if (!hasLinkedAccount) {
          this.logger.log(`User ${userId} has no linked Stellar accounts`);
          return {
            totalValueUsd: '0.00',
            assets: [],
            lastUpdated: null,
            hasLinkedAccount: false,
          };
        }

        // User has linked accounts, try to get the latest snapshot
        const latestSnapshot = await this.snapshotRepository.findOne({
          where: { userId },
          order: { createdAt: 'DESC' },
        });

        if (!latestSnapshot) {
          // User has accounts but no snapshot yet
          return {
            totalValueUsd: '0.00',
            assets: [],
            lastUpdated: null,
            hasLinkedAccount: true, // Important: set to true even without snapshot
          };
        }

        return {
          totalValueUsd: latestSnapshot.totalValueUsd,
          assets: latestSnapshot.assetBalances,
          lastUpdated: latestSnapshot.createdAt,
          hasLinkedAccount: true,
        };
      },
      { label: 'PortfolioService.getPortfolioSummary', thresholdMs: 200 },
    );
  }

  /**
   * Get portfolio summary in a specific currency
   */
  async getPortfolioSummaryInCurrency(
    userId: string,
    currency: CurrencyCode = CurrencyCode.USD,
  ): Promise<PortfolioSummaryWithCurrencyResponseDto> {
    this.logger.log(
      `Fetching portfolio summary for user ${userId} in currency ${currency}`,
    );

    // Get base USD summary
    const usdSummary = await this.getPortfolioSummary(userId);

    // If USD or no assets, return as is
    if (currency === CurrencyCode.USD || usdSummary.assets.length === 0) {
      return {
        totalValue: usdSummary.totalValueUsd,
        currency: CurrencyCode.USD,
        totalValueUsd: usdSummary.totalValueUsd,
        assets: usdSummary.assets.map((asset) => ({
          assetCode: asset.assetCode,
          assetIssuer: asset.assetIssuer,
          amount: asset.amount,
          value: asset.valueUsd,
          valueUsd: asset.valueUsd,
        })),
        lastUpdated: usdSummary.lastUpdated,
        hasLinkedAccount: usdSummary.hasLinkedAccount,
        exchangeRate: 1,
      };
    }

    // Convert to requested currency
    const totalUsd = parseFloat(usdSummary.totalValueUsd);
    const exchangeRate = await this.exchangeRatesService.getExchangeRate(
      CurrencyCode.USD,
      currency,
    );

    const convertedTotal = Math.round(totalUsd * exchangeRate * 100) / 100;

    const convertedAssets: AssetBalanceWithCurrencyDto[] =
      usdSummary.assets.map((asset) => ({
        assetCode: asset.assetCode,
        assetIssuer: asset.assetIssuer,
        amount: asset.amount,
        value: Math.round(asset.valueUsd * exchangeRate * 100) / 100,
        valueUsd: asset.valueUsd,
      }));

    return {
      totalValue: convertedTotal.toFixed(2),
      currency,
      totalValueUsd: usdSummary.totalValueUsd,
      assets: convertedAssets,
      lastUpdated: usdSummary.lastUpdated,
      hasLinkedAccount: usdSummary.hasLinkedAccount,
      exchangeRate,
    };
  }

  // /**
  //  * Get portfolio summary (latest snapshot) for the mobile dashboard
  //  * Returns total USD value and individual asset balances
  //  */
  // async getPortfolioSummary(
  //   userId: string,
  // ): Promise<PortfolioSummaryResponseDto> {
  //   this.logger.log(`Fetching portfolio summary for user ${userId}`);

  //   const latestSnapshot = await this.snapshotRepository.findOne({
  //     where: { userId },
  //     order: { createdAt: 'DESC' },
  //   });

  //   if (!latestSnapshot) {
  //     return {
  //       totalValueUsd: '0.00',
  //       assets: [],
  //       lastUpdated: null,
  //       hasLinkedAccount: false,
  //     };
  //   }

  //   return {
  //     totalValueUsd: latestSnapshot.totalValueUsd,
  //     assets: latestSnapshot.assetBalances,
  //     lastUpdated: latestSnapshot.createdAt,
  //     hasLinkedAccount: true,
  //   };
  // }

  /**
   * Scheduled job to create snapshots for all users
   * Runs daily at midnight
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async createSnapshotsForAllUsers(): Promise<void> {
    this.logger.log('Starting scheduled snapshot creation for all users');
    try {
      const progress =
        await this.snapshotQueueService.enqueueSnapshotBatch('cron');
      this.logger.log(
        `Snapshot batch queued (cron). BatchId=${progress.batchId}`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to queue snapshot batch job: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Manual trigger for creating snapshots (useful for testing)
   */
  async triggerSnapshotCreation(): Promise<PortfolioSnapshotBatchStatus> {
    this.logger.log('Manual snapshot creation triggered');
    return this.snapshotQueueService.enqueueSnapshotBatch('manual');
  }

  async getSnapshotBatchStatus(
    batchId: string,
  ): Promise<PortfolioSnapshotBatchStatus> {
    return this.snapshotQueueService.getBatchStatus(batchId);
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

  /**
   * Get portfolio asset allocation breakdown.
   *
   * Aggregates assets across all linked Stellar accounts for a user,
   * calculates the USD value of each asset, and determines its percentage
   * of the total portfolio value.
   *
   * @param userId The ID of the user.
   * @returns An object with the total portfolio value and an array of assets with their allocation details.
   */
  async getAssetAllocation(userId: string): Promise<{
    totalValueUsd: number;
    allocation: Array<{
      assetCode: string;
      assetIssuer: string | null;
      amount: string;
      valueUsd: number;
      percentage: number;
    }>;
  }> {
    this.logger.log(`Fetching asset allocation for user ${userId}`);

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['stellarAccounts'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (!user.stellarAccounts || user.stellarAccounts.length === 0) {
      this.logger.log(`User ${userId} has no linked Stellar accounts`);
      return { totalValueUsd: 0, allocation: [] };
    }

    const aggregatedBalances: Map<
      string,
      { amount: number; assetCode: string; assetIssuer: string | null }
    > = new Map();

    // Fetch balances for all linked accounts concurrently
    const balancePromises = user.stellarAccounts.map((account) =>
      this.stellarBalanceService
        .getAccountBalances(account.publicKey)
        .catch((error) => {
          this.logger.warn(
            `Failed to fetch balances for account ${account.publicKey}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
          return []; // Return empty array on failure to not break Promise.all
        }),
    );

    const accountsBalances = await Promise.all(balancePromises);

    // Aggregate balances from all accounts
    for (const balances of accountsBalances) {
      for (const balance of balances) {
        const key = `${balance.assetCode}:${balance.assetIssuer || 'native'}`;
        const existing = aggregatedBalances.get(key);
        const currentAmount = parseFloat(balance.balance);

        if (existing) {
          existing.amount += currentAmount;
        } else {
          aggregatedBalances.set(key, {
            amount: currentAmount,
            assetCode: balance.assetCode,
            assetIssuer: balance.assetIssuer,
          });
        }
      }
    }

    // Calculate USD value for each aggregated asset concurrently
    const allocationWithValue = await Promise.all(
      Array.from(aggregatedBalances.values()).map(async (asset) => {
        const valueUsd = await this.stellarBalanceService.getAssetValueUsd(
          asset.assetCode,
          asset.assetIssuer,
          asset.amount.toString(),
        );
        return {
          assetCode: asset.assetCode,
          assetIssuer: asset.assetIssuer,
          amount: asset.amount.toString(),
          valueUsd,
        };
      }),
    );

    // Calculate total value from the results
    const totalValueUsd = allocationWithValue.reduce(
      (sum, asset) => sum + asset.valueUsd,
      0,
    );

    // Calculate percentage for each asset, handling division by zero
    const finalAllocation = allocationWithValue.map((asset) => ({
      ...asset,
      percentage:
        totalValueUsd > 0 ? (asset.valueUsd / totalValueUsd) * 100 : 0,
    }));

    return {
      totalValueUsd,
      allocation: finalAllocation,
    };
  }
}
