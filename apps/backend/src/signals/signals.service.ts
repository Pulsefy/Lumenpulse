import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TransactionService } from '../transaction/transaction.service';
import { UsersService } from '../users/users.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import {
  SignalCategory,
  SignalSeverity,
  UserSignalDto,
  UserSignalsResponseDto,
} from './dto/signals.dto';
import {
  TransactionDto,
  TransactionStatus,
  TransactionType,
} from '../transaction/dto/transaction.dto';
import { PortfolioSummaryResponseDto } from '../portfolio/dto/portfolio-snapshot.dto';
import { StellarAccountResponseDto } from '../users/dto/stellar-account-response.dto';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const STABLECOIN_CODES = new Set(['USDC', 'USDT', 'EURT', 'BUSD', 'DAI']);

@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly transactionService: TransactionService,
    private readonly portfolioService: PortfolioService,
  ) {}

  async getLatestSignals(userId: string): Promise<UserSignalsResponseDto> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const accounts = await this.usersService.getStellarAccounts(userId);
    const publicKey = this.determinePrimaryPublicKey(
      accounts,
      user.stellarPublicKey,
    );

    const [portfolioSummary, transactionHistory] = await Promise.all([
      this.portfolioService.getPortfolioSummary(userId),
      publicKey
        ? this.transactionService.getTransactionHistory(publicKey, 25)
        : Promise.resolve({ transactions: [] as TransactionDto[] }),
    ]);

    const signals = this.buildSignals(
      portfolioSummary,
      transactionHistory.transactions,
      publicKey !== null,
    );

    return {
      userId,
      generatedAt: new Date(),
      signals,
    };
  }

  private determinePrimaryPublicKey(
    accounts: StellarAccountResponseDto[],
    fallbackPublicKey?: string,
  ): string | null {
    const primaryAccount = accounts.find((account) => account.isPrimary);
    if (primaryAccount?.publicKey) {
      return primaryAccount.publicKey;
    }

    if (accounts.length > 0 && accounts[0].publicKey) {
      return accounts[0].publicKey;
    }

    return fallbackPublicKey || null;
  }

  private buildSignals(
    portfolioSummary: PortfolioSummaryResponseDto,
    transactions: TransactionDto[],
    hasAuthenticatedAccount: boolean,
  ): UserSignalDto[] {
    const signals: UserSignalDto[] = [];
    const totalValueUsd = Number(portfolioSummary.totalValueUsd) || 0;
    const assets = portfolioSummary.assets || [];
    const assetCount = assets.length;

    if (!hasAuthenticatedAccount && totalValueUsd === 0 && assetCount === 0) {
      signals.push({
        category: SignalCategory.FALLBACK,
        severity: SignalSeverity.LOW,
        title: 'No holdings or linked account',
        detail:
          'No linked Stellar account or portfolio snapshot is available. Connect an account to enable signal generation.',
      });
      signals.push({
        category: SignalCategory.FALLBACK,
        severity: SignalSeverity.LOW,
        title: 'No recent activity available',
        detail:
          'Transaction history is unavailable until a linked account is configured.',
      });
      return signals;
    }

    if (assetCount === 0) {
      signals.push({
        category: SignalCategory.HOLDINGS,
        severity: SignalSeverity.LOW,
        title: 'Portfolio is empty or unavailable',
        detail:
          'No asset balances were found for the current user. This may indicate an empty portfolio or a missing snapshot.',
      });
    } else {
      const sortedAssets = [...assets].sort((a, b) => b.valueUsd - a.valueUsd);
      const topAsset = sortedAssets[0];
      const topConcentration =
        totalValueUsd > 0 ? topAsset.valueUsd / totalValueUsd : 0;
      const stablecoinExposure = assets
        .filter((asset) => STABLECOIN_CODES.has(asset.assetCode.toUpperCase()))
        .reduce((sum, asset) => sum + asset.valueUsd, 0);
      const stablecoinExposurePct =
        totalValueUsd > 0 ? stablecoinExposure / totalValueUsd : 0;

      if (totalValueUsd > 0 && totalValueUsd < 1000) {
        signals.push({
          category: SignalCategory.RISK,
          severity: SignalSeverity.LOW,
          title: 'Smaller portfolio size',
          detail:
            'Total portfolio value is under $1,000, limiting the scale of risk exposure and trading activity.',
        });
      }

      if (assetCount === 1) {
        signals.push({
          category: SignalCategory.RISK,
          severity: SignalSeverity.MEDIUM,
          title: 'Single-asset concentration',
          detail: `The portfolio holds only ${topAsset.assetCode}, which may increase exposure to a single asset.`,
        });
      }

      if (topConcentration >= 0.65) {
        signals.push({
          category: SignalCategory.RISK,
          severity: SignalSeverity.HIGH,
          title: 'Concentrated holdings',
          detail: `More than ${Math.round(topConcentration * 100)}% of portfolio value is held in ${topAsset.assetCode}.`,
        });
      } else if (assetCount >= 4) {
        signals.push({
          category: SignalCategory.HOLDINGS,
          severity: SignalSeverity.LOW,
          title: 'Diversified holdings',
          detail: `The portfolio contains ${assetCount} distinct assets, which helps spread risk across positions.`,
        });
      }

      if (stablecoinExposurePct > 0) {
        signals.push({
          category: SignalCategory.RISK,
          severity:
            stablecoinExposurePct >= 0.4
              ? SignalSeverity.MEDIUM
              : SignalSeverity.LOW,
          title: 'Stablecoin exposure',
          detail: `Stablecoins represent ${Math.round(stablecoinExposurePct * 100)}% of the portfolio, which may reduce volatility and limit short-term upside.`,
        });
      }
    }

    const activitySignals = this.buildActivitySignals(transactions);
    signals.push(...activitySignals);

    if (signals.length === 0) {
      signals.push({
        category: SignalCategory.FALLBACK,
        severity: SignalSeverity.LOW,
        title: 'No determinable signal',
        detail:
          'No meaningful signal could be generated from the available holdings and activity. More data will improve results.',
      });
    }

    return signals.slice(0, 6);
  }

  private buildActivitySignals(
    transactions: TransactionDto[],
  ): UserSignalDto[] {
    if (!transactions || transactions.length === 0) {
      return [
        {
          category: SignalCategory.ACTIVITY,
          severity: SignalSeverity.LOW,
          title: 'No recent activity',
          detail:
            'No recent transaction history is available for the selected account.',
        },
      ];
    }

    const now = Date.now();
    const parsedTransactions = transactions
      .map((transaction) => ({
        transaction,
        timestamp: new Date(transaction.date).getTime(),
      }))
      .filter((entry) => !Number.isNaN(entry.timestamp));

    const latest = parsedTransactions.reduce(
      (best, current) => (current.timestamp > best.timestamp ? current : best),
      parsedTransactions[0],
    );
    const latestAgeDays = Math.floor((now - latest.timestamp) / MS_PER_DAY);
    const failedCount = transactions.filter(
      (transaction) => transaction.status === TransactionStatus.FAILED,
    ).length;
    const swapCount = transactions.filter(
      (transaction) => transaction.type === TransactionType.SWAP,
    ).length;
    const trustlineCount = transactions.filter(
      (transaction) => transaction.type === TransactionType.TRUSTLINE,
    ).length;

    const signals: UserSignalDto[] = [];

    if (failedCount > 0) {
      signals.push({
        category: SignalCategory.ACTIVITY,
        severity: SignalSeverity.MEDIUM,
        title: 'Recent failed transaction',
        detail: `There is at least one failed transaction in the recent activity feed. Review the transaction details for potential issues.`,
      });
    }

    if (swapCount > 0 || trustlineCount > 0) {
      signals.push({
        category: SignalCategory.ACTIVITY,
        severity: SignalSeverity.MEDIUM,
        title: 'Account is actively rebalancing',
        detail: `Recent ${swapCount > 0 ? 'swap' : 'trustline'} activity suggests the account is adjusting its portfolio.`,
      });
    }

    if (latestAgeDays <= 1) {
      signals.push({
        category: SignalCategory.ACTIVITY,
        severity: SignalSeverity.LOW,
        title: 'Very recent activity',
        detail: 'The account has activity within the last 24 hours.',
      });
    } else if (latestAgeDays > 30) {
      signals.push({
        category: SignalCategory.ACTIVITY,
        severity: SignalSeverity.LOW,
        title: 'No activity in the last 30 days',
        detail:
          'The account has been quiet for more than 30 days. A dormant account may miss market signals.',
      });
    } else if (latestAgeDays > 7) {
      signals.push({
        category: SignalCategory.ACTIVITY,
        severity: SignalSeverity.LOW,
        title: 'Moderately quiet account',
        detail:
          'Recent activity is older than one week, but the account is not fully dormant.',
      });
    }

    if (signals.length === 0) {
      signals.push({
        category: SignalCategory.ACTIVITY,
        severity: SignalSeverity.LOW,
        title: 'Normal recent activity',
        detail:
          'Recent transactions are available and do not indicate unusual risk behavior.',
      });
    }

    return signals;
  }
}
