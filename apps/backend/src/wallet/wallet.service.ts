import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { StellarService } from '../stellar/stellar.service';
import { CacheService } from '../cache/cache.service';
import { MetricsService } from '../metrics/metrics.service';
import { AssetBalanceDto } from '../stellar/dto/balance.dto';
import {
  WalletReadinessQueryDto,
  WalletReadinessResponseDto,
  ReadinessStatus,
  WalletAction,
  ReadinessIssueDto,
  TrustlineStatusDto,
} from './dto/wallet.dto';

const MINIMUM_BALANCE_STROOPS = 20000000; // 2 XLM minimum balance
const TRUSTLINE_COST_STROOPS = 350000; // 0.035 XLM per trustline

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly stellarService: StellarService,
    private readonly cacheService: CacheService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Validate wallet readiness for a specific action
   */
  async validateWalletReadiness(
    query: WalletReadinessQueryDto,
  ): Promise<WalletReadinessResponseDto> {
    const startTime = Date.now();

    try {
      const { publicKey, action, tokenAddress, requiredAmount } = query;

      // Validate public key format
      this.stellarService.validatePublicKeyOrThrow(publicKey);

      // Check account existence
      const accountExists = await this.stellarService.accountExists(publicKey);

      if (!accountExists) {
        return this.createNotFundedResponse();
      }

      // Get account balances
      const accountBalances =
        await this.stellarService.getAccountBalances(publicKey);

      // Extract native balance
      const nativeBalance = this.extractNativeBalance(accountBalances.balances);

      // Check funding status
      const isFunded = BigInt(nativeBalance) >= BigInt(MINIMUM_BALANCE_STROOPS);

      // Check trustlines if required
      const trustlines = this.checkTrustlines(
        action,
        tokenAddress,
        accountBalances.balances,
      );

      // Validate action-specific requirements
      const issues = this.validateActionRequirements(
        action,
        nativeBalance,
        trustlines,
        requiredAmount,
      );

      // Determine overall readiness
      const isReady = issues.filter((i) => i.critical).length === 0;
      const status = this.determineReadinessStatus(isReady, issues);

      // Generate recommendations
      const recommendations = this.generateRecommendations(issues, action);

      const response: WalletReadinessResponseDto = {
        status,
        isReady,
        accountExists,
        isFunded,
        nativeBalance,
        minimumBalance: MINIMUM_BALANCE_STROOPS.toString(),
        trustlines,
        issues,
        recommendations,
        validatedAt: new Date(),
      };

      const duration = Date.now() - startTime;
      this.metricsService.recordHistogram(
        'wallet_readiness_validation_duration_ms',
        duration,
      );
      this.logger.log(
        `Validated wallet readiness for ${publicKey} in ${duration}ms`,
      );

      return response;
    } catch (error) {
      this.logger.error('Error validating wallet readiness:', error);
      this.metricsService.incrementCounter('wallet_readiness_errors_total');

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new Error('Failed to validate wallet readiness');
    }
  }

  /**
   * Create response for non-existent/unfunded accounts
   */
  private createNotFundedResponse(): WalletReadinessResponseDto {
    const issues: ReadinessIssueDto[] = [
      {
        type: 'ACCOUNT_NOT_FUNDED',
        message: 'Account does not exist or is not funded on the network',
        critical: true,
        resolution: [
          'Fund the account with at least 2 XLM on testnet',
          'Use a testnet faucet to get initial funds',
          'Ensure the public key is correct',
        ],
      },
    ];

    return {
      status: ReadinessStatus.NOT_READY,
      isReady: false,
      accountExists: false,
      isFunded: false,
      nativeBalance: '0',
      minimumBalance: MINIMUM_BALANCE_STROOPS.toString(),
      trustlines: [],
      issues,
      recommendations: [
        'Fund your wallet using a testnet faucet',
        'Ensure you have at least 2 XLM for minimum balance',
      ],
      validatedAt: new Date(),
    };
  }

  /**
   * Extract native XLM balance from balances array
   */
  private extractNativeBalance(balances: AssetBalanceDto[]): string {
    const native = balances.find((b) => b.assetType === 'native');
    return native?.balance || '0';
  }

  /**
   * Check trustlines for required tokens
   */
  private checkTrustlines(
    action: WalletAction,
    tokenAddress: string | undefined,
    balances: AssetBalanceDto[],
  ): TrustlineStatusDto[] {
    const trustlines: TrustlineStatusDto[] = [];

    // Actions that may require trustlines
    const trustlineRequiredActions = [
      WalletAction.CONTRIBUTE,
      WalletAction.TRANSFER,
      WalletAction.CLAIM_REWARDS,
    ];

    if (!trustlineRequiredActions.includes(action) || !tokenAddress) {
      return trustlines;
    }

    // Parse token address to get asset code and issuer
    // This is a simplified version - in production you'd parse this properly
    const assetCode = this.extractAssetCode(tokenAddress);
    const issuer = this.extractIssuer(tokenAddress);

    // Check if trustline exists
    const existingTrustline = balances.find(
      (b) => b.assetCode === assetCode && b.assetIssuer === issuer,
    );

    trustlines.push({
      assetCode,
      issuer,
      exists: !!existingTrustline,
      balance: existingTrustline?.balance || '0',
      limit: existingTrustline?.limit,
    });

    return trustlines;
  }

  /**
   * Validate action-specific requirements
   */
  private validateActionRequirements(
    action: WalletAction,
    nativeBalance: string,
    trustlines: TrustlineStatusDto[],
    requiredAmount?: string,
  ): ReadinessIssueDto[] {
    const issues: ReadinessIssueDto[] = [];
    const balance = BigInt(nativeBalance);

    // Check minimum balance for all actions
    if (balance < BigInt(MINIMUM_BALANCE_STROOPS)) {
      issues.push({
        type: 'INSUFFICIENT_NATIVE_BALANCE',
        message: `Insufficient native balance. Required: ${MINIMUM_BALANCE_STROOPS} stroops, Available: ${nativeBalance} stroops`,
        critical: true,
        resolution: [
          'Add more XLM to your wallet',
          'Use a testnet faucet to get additional funds',
        ],
      });
    }

    // Action-specific validations
    switch (action) {
      case WalletAction.CONTRIBUTE:
        if (requiredAmount) {
          const required = BigInt(requiredAmount);
          const totalRequired = required + BigInt(TRUSTLINE_COST_STROOPS);

          if (balance < totalRequired) {
            issues.push({
              type: 'INSUFFICIENT_FUNDS_FOR_ACTION',
              message: `Insufficient funds for contribution. Required: ${totalRequired} stroops, Available: ${balance} stroops`,
              critical: true,
              resolution: [
                'Add more XLM to cover the contribution amount',
                'Consider contributing a smaller amount',
              ],
            });
          }
        }

        // Check trustline for token if specified
        if (trustlines.length > 0 && !trustlines[0].exists) {
          issues.push({
            type: 'MISSING_TRUSTLINE',
            message: `Missing trustline for ${trustlines[0].assetCode}`,
            critical: true,
            resolution: [
              `Establish trustline for ${trustlines[0].assetCode}`,
              `Trustline requires ${TRUSTLINE_COST_STROOPS} stroops`,
            ],
          });
        }
        break;

      case WalletAction.WITHDRAW:
        if (balance < BigInt(MINIMUM_BALANCE_STROOPS) + BigInt(100000)) {
          issues.push({
            type: 'INSUFFICIENT_FUNDS_FOR_WITHDRAWAL',
            message: 'Insufficient funds to cover withdrawal fees',
            critical: true,
            resolution: [
              'Ensure you have enough XLM to cover withdrawal fees',
              'Minimum balance must be maintained',
            ],
          });
        }
        break;

      case WalletAction.CREATE_PROJECT:
        if (balance < BigInt(MINIMUM_BALANCE_STROOPS) + BigInt(5000000)) {
          issues.push({
            type: 'INSUFFICIENT_FUNDS_FOR_PROJECT',
            message: 'Insufficient funds to create project (requires ~0.5 XLM)',
            critical: true,
            resolution: [
              'Add more XLM to your wallet',
              'Project creation requires additional funds for initialization',
            ],
          });
        }
        break;

      case WalletAction.TRANSFER:
        if (requiredAmount) {
          const required = BigInt(requiredAmount);
          if (balance < required + BigInt(100000)) {
            issues.push({
              type: 'INSUFFICIENT_FUNDS_FOR_TRANSFER',
              message: 'Insufficient funds to cover transfer amount and fees',
              critical: true,
              resolution: [
                'Add more XLM to cover the transfer amount',
                'Ensure you have enough for transaction fees',
              ],
            });
          }
        }
        break;

      case WalletAction.CLAIM_REWARDS:
        if (trustlines.length > 0 && !trustlines[0].exists) {
          issues.push({
            type: 'MISSING_TRUSTLINE',
            message: `Missing trustline to receive ${trustlines[0].assetCode} rewards`,
            critical: true,
            resolution: [
              `Establish trustline for ${trustlines[0].assetCode} before claiming`,
            ],
          });
        }
        break;
    }

    return issues;
  }

  /**
   * Determine overall readiness status
   */
  private determineReadinessStatus(
    isReady: boolean,
    issues: ReadinessIssueDto[],
  ): ReadinessStatus {
    if (isReady) {
      return ReadinessStatus.READY;
    }

    const criticalIssues = issues.filter((i) => i.critical);
    const nonCriticalIssues = issues.filter((i) => !i.critical);

    if (criticalIssues.length > 0) {
      return ReadinessStatus.NOT_READY;
    }

    if (nonCriticalIssues.length > 0) {
      return ReadinessStatus.PARTIAL;
    }

    return ReadinessStatus.NOT_READY;
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(
    issues: ReadinessIssueDto[],
    action: WalletAction,
  ): string[] {
    const recommendations: string[] = [];

    // Group issues by type
    const issueTypes = new Set(issues.map((i) => i.type));

    if (issueTypes.has('ACCOUNT_NOT_FUNDED')) {
      recommendations.push('Fund your wallet using a testnet faucet');
    }

    if (issueTypes.has('INSUFFICIENT_NATIVE_BALANCE')) {
      recommendations.push('Add more XLM to meet minimum balance requirements');
    }

    if (issueTypes.has('MISSING_TRUSTLINE')) {
      recommendations.push(
        'Establish required trustlines for token operations',
      );
    }

    if (issueTypes.has('INSUFFICIENT_FUNDS_FOR_ACTION')) {
      recommendations.push('Add more funds to cover the intended action');
    }

    // Action-specific recommendations
    switch (action) {
      case WalletAction.CONTRIBUTE:
        recommendations.push(
          'Ensure you have enough XLM for contribution and fees',
        );
        break;
      case WalletAction.CREATE_PROJECT:
        recommendations.push(
          'Ensure you have at least 2.5 XLM for project creation',
        );
        break;
      case WalletAction.TRANSFER:
        recommendations.push(
          'Verify recipient address and amount before transferring',
        );
        break;
    }

    return recommendations.length > 0
      ? recommendations
      : ['Wallet is ready for the requested action'];
  }

  /**
   * Extract asset code from token address (simplified)
   */
  private extractAssetCode(tokenAddress: string): string {
    // In production, this would properly parse the Stellar asset.
    // For now, use the segment before ":" when present.
    return tokenAddress.split(':')[0] || 'CUSTOM';
  }

  /**
   * Extract issuer from token address (simplified)
   */
  private extractIssuer(tokenAddress: string): string {
    // In production, this would properly parse the Stellar asset
    // For now, return the address as issuer
    return tokenAddress;
  }

  /**
   * Health check for wallet service
   */
  async healthCheck(): Promise<{
    status: string;
    stellar: boolean;
    cache: boolean;
  }> {
    const stellarHealth = await this.stellarService.checkHealth();
    const cacheHealth = await this.cacheService.checkHealth();

    return {
      status: stellarHealth && cacheHealth ? 'healthy' : 'unhealthy',
      stellar: stellarHealth,
      cache: cacheHealth,
    };
  }
}
