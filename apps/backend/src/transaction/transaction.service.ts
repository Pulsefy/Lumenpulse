import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TransactionDto,
  TransactionType,
  TransactionStatus,
} from './dto/transaction.dto';
import { getMockTransactions } from './mocks/mock-transactions';

interface HorizonOperation {
  id: string;
  type: string;
  created_at: string;
  transaction_hash: string;
  source_account: string;
  from?: string;
  to?: string;
  into?: string;
  amount?: string;
  amount_charged?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  starting_balance?: string;
  funder?: string;
  account?: string;
  trustor?: string;
  trustee?: string;
  limit?: string;
  offer_id?: string;
  buying_asset_code?: string;
  selling_asset_code?: string;
  buying_asset_type?: string;
  selling_asset_type?: string;
  [key: string]: unknown;
}

interface HorizonResponse {
  _embedded: {
    records: HorizonTransaction[];
  };
  _links: {
    next?: {
      href: string;
    };
  };
}

interface HorizonErrorResponse {
  detail?: string;
  title?: string;
  status?: number;
}

interface HorizonTransaction {
  id: string;
  created_at: string;
  successful: boolean;
  memo?: string;
  fee_charged?: string;
}

interface OperationsResponse {
  _embedded?: {
    records: HorizonOperation[];
  };
}

@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);
  private readonly horizonUrl: string;
  private readonly useMockData: boolean;

  constructor(private configService: ConfigService) {
    const network = this.configService.get('STELLAR_NETWORK', 'testnet');
    this.horizonUrl =
      network === 'testnet'
        ? 'https://horizon-testnet.stellar.org'
        : 'https://horizon.stellar.org';

    this.useMockData =
      this.configService.get('USE_MOCK_TRANSACTIONS', 'true') === 'true';
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

    try {
      let url = `${this.horizonUrl}/accounts/${publicKey}/transactions?order=desc&limit=${limit}`;
      if (cursor) {
        url += `&cursor=${cursor}`;
      }

      const response = await fetch(url);
      const data = (await response.json()) as
        | HorizonResponse
        | HorizonErrorResponse;

      if (!response.ok) {
        const errorDetail = (data as HorizonErrorResponse).detail;
        const errorMessage = errorDetail || 'Failed to fetch transactions';
        throw new Error(errorMessage);
      }

      const horizonData = data as HorizonResponse;
      const transactions = await this.processTransactions(
        horizonData._embedded.records,
        publicKey,
      );
      let nextPage: string | undefined;

      if (horizonData._links?.next?.href) {
        const nextUrl = new URL(horizonData._links.next.href);
        nextPage = nextUrl.searchParams.get('cursor') || undefined;
      }

      return { transactions, nextPage };
    } catch (error) {
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
    try {
      const url = `${this.horizonUrl}/transactions/${transactionId}/operations`;
      const response = await fetch(url);
      const data = (await response.json()) as OperationsResponse;
      return data._embedded?.records || [];
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to fetch operations for ${transactionId}: ${errorMessage}`,
      );
      return [];
    }
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
