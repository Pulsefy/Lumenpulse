import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TransactionDto,
  TransactionType,
  TransactionStatus,
} from './dto/transaction.dto';
import { getMockTransactions } from './mocks/mock-transactions';
import { CacheService } from '../cache/cache.service';
import {
  HorizonClientService,
  HorizonOperation,
  HorizonTransaction,
} from '../stellar/services/horizon-client.service';

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);
  private readonly useMockData: boolean;

  constructor(
    private configService: ConfigService,
    private cacheService: CacheService,
    private horizonClient: HorizonClientService,
  ) {
    this.useMockData =
      this.configService.get('USE_MOCK_TRANSACTIONS', 'true') === 'true';

    this.cacheService.setCacheConfig({
      balanceCacheTTL: this.configService.get<number>(
        'STELLAR_BALANCE_CACHE_TTL',
        30_000,
      ),
      operationsCacheTTL: this.configService.get<number>(
        'STELLAR_OPERATIONS_CACHE_TTL',
        15_000,
      ),
      contractReadTTL: 60_000,
    });

    if (this.useMockData) {
      this.logger.log('Using mock transaction data for testing');
    }
  }

  async getTransactionHistory(
    publicKey: string,
    limit: number = 50,
    cursor?: string,
  ): Promise<{ transactions: TransactionDto[]; nextPage?: string }> {
    this.logger.log(`Fetching transaction history for ${publicKey}`);

    if (this.useMockData) {
      this.logger.log('Returning mock transaction data');
      return getMockTransactions(limit, cursor);
    }

    return this.cacheService.getAccountOperationsCached(
      publicKey,
      limit,
      async () => this.fetchTransactionHistory(publicKey, limit, cursor),
      cursor,
    );
  }

  private async fetchTransactionHistory(
    publicKey: string,
    limit: number,
    cursor?: string,
  ): Promise<{ transactions: TransactionDto[]; nextPage?: string }> {
    try {
      const { transactions: horizonTransactions, nextPage } =
        await this.horizonClient.getTransactions(publicKey, limit, cursor);

      const transactions = await this.processTransactions(
        horizonTransactions,
        publicKey,
      );

      return { transactions, nextPage };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to fetch transactions: ${errorMessage}`);
      return { transactions: [] };
    }
  }

  private async processTransactions(
    records: HorizonTransaction[],
    publicKey: string,
  ): Promise<TransactionDto[]> {
    const transactions: TransactionDto[] = [];

    for (const record of records) {
      const operations = await this.getTransactionOperations(record.id);

      for (const operation of operations) {
        const transaction = this.mapToTransactionDto(
          operation,
          record,
          publicKey,
        );
        if (transaction) {
          transactions.push(transaction);
        }
      }
    }

    return transactions;
  }

  private async getTransactionOperations(
    transactionId: string,
  ): Promise<HorizonOperation[]> {
    return this.horizonClient.getOperations(transactionId);
  }

  private mapToTransactionDto(
    operation: HorizonOperation,
    transaction: HorizonTransaction,
    publicKey: string,
  ): TransactionDto | null {
    const type = this.mapTransactionType(operation.type);
    if (!type) return null;

    const amount = this.getAmountFromOperation(operation);
    const assetCode = this.getAssetCode(operation);
    const from =
      operation.source_account || operation.from || operation.funder || '';
    const to = operation.to || operation.into || operation.account || '';

    const dto: TransactionDto = {
      id: operation.id,
      type,
      amount,
      assetCode,
      assetIssuer: this.getAssetIssuer(operation),
      from,
      to,
      date: operation.created_at,
      status: transaction.successful
        ? TransactionStatus.SUCCESS
        : TransactionStatus.FAILED,
      transactionHash: transaction.id,
      memo: transaction.memo,
      fee: transaction.fee_charged,
      description: this.buildDescription(
        operation,
        type,
        amount,
        assetCode,
        publicKey,
        from,
        to,
      ),
    };

    return dto;
  }

  private mapTransactionType(horizonType: string): TransactionType | null {
    switch (horizonType) {
      case 'payment':
      case 'path_payment':
      case 'path_payment_strict_send':
      case 'path_payment_strict_receive':
        return TransactionType.PAYMENT;
      case 'manage_offer':
      case 'create_passive_offer':
      case 'manage_buy_offer':
      case 'manage_sell_offer':
        return TransactionType.SWAP;
      case 'change_trust':
        return TransactionType.TRUSTLINE;
      case 'create_account':
        return TransactionType.CREATE_ACCOUNT;
      case 'account_merge':
        return TransactionType.ACCOUNT_MERGE;
      case 'inflation':
        return TransactionType.INFLATION;
      default:
        return null;
    }
  }

  private buildDescription(
    operation: HorizonOperation,
    type: TransactionType,
    amount: string,
    assetCode: string,
    publicKey: string,
    from: string,
    to: string,
  ): string {
    const short = (key: string) =>
      key ? `${key.slice(0, 4)}...${key.slice(-4)}` : 'unknown';

    switch (type) {
      case TransactionType.PAYMENT:
        if (from === publicKey) {
          return `Sent ${amount} ${assetCode} to ${short(to)}`;
        }
        return `Received ${amount} ${assetCode} from ${short(from)}`;

      case TransactionType.SWAP: {
        const selling =
          operation.selling_asset_type === 'native'
            ? 'XLM'
            : (operation.selling_asset_code as string) || 'unknown';
        const buying =
          operation.buying_asset_type === 'native'
            ? 'XLM'
            : (operation.buying_asset_code as string) || 'unknown';
        return `Swapped ${amount} ${selling} for ${buying}`;
      }

      case TransactionType.TRUSTLINE: {
        const asset = assetCode !== 'XLM' ? assetCode : 'asset';
        const limit = operation.limit;
        if (limit === '0') {
          return `Removed trustline for ${asset}`;
        }
        return `Added trustline for ${asset}`;
      }

      case TransactionType.CREATE_ACCOUNT:
        return `Created account ${short(to)} with ${amount} XLM`;

      case TransactionType.ACCOUNT_MERGE:
        return `Merged account into ${short(to)}`;

      case TransactionType.INFLATION:
        return `Received inflation payout of ${amount} XLM`;

      default:
        return `${String(type)} operation`;
    }
  }

  private getAmountFromOperation(operation: HorizonOperation): string {
    const amount =
      operation.amount ??
      operation.amount_charged ??
      operation.starting_balance;
    return amount ?? '0';
  }

  private getAssetCode(operation: HorizonOperation): string {
    if (operation.asset_type === 'native') return 'XLM';
    const assetCode = operation.asset_code;
    return assetCode ?? (operation.asset_issuer ? 'Custom' : 'XLM');
  }

  private getAssetIssuer(operation: HorizonOperation): string | null {
    return operation.asset_issuer ?? null;
  }
}
