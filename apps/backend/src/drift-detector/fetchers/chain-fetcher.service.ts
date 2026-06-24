import { Injectable, Logger } from '@nestjs/common';
import { StellarService } from '../../stellar/stellar.service';
import { SorobanRpcClientService } from '../../stellar/services/soroban-rpc-client.service';
import { PortfolioAssetOnChain, ProjectRegistryOnChain } from '../interfaces/drift.types';

export interface AccountOnChain {
  exists: boolean;
  sequenceNumber: string | null;
  balances: PortfolioAssetOnChain[];
}

@Injectable()
export class ChainFetcherService {
  private readonly logger = new Logger(ChainFetcherService.name);

  constructor(
    private readonly stellarService: StellarService,
    private readonly sorobanRpc: SorobanRpcClientService,
  ) {}

  async fetchAccount(publicKey: string): Promise<AccountOnChain> {
    const exists = await this.stellarService.accountExists(publicKey);
    if (!exists) {
      return { exists: false, sequenceNumber: null, balances: [] };
    }

    try {
      const info = await this.stellarService.getAccountBalances(publicKey);
      const balances: PortfolioAssetOnChain[] = info.balances.map((b) => ({
        assetCode: b.assetCode ?? 'XLM',
        assetIssuer: b.assetIssuer ?? null,
        balance: b.balance,
      }));

      return {
        exists: true,
        sequenceNumber: info.sequenceNumber ?? null,
        balances,
      };
    } catch {
      return { exists: true, sequenceNumber: null, balances: [] };
    }
  }

  async fetchProjectRegistry(contractId: string): Promise<ProjectRegistryOnChain | null> {
    try {
      const account = await this.sorobanRpc.getAccount(contractId);
      const contractState = await this.sorobanRpc.simulateContractRead(
        contractId,
        account.sequenceNumber(),
        contractId,
        'read_project',
        'Test SDA Network ; September 2015',
      );

      if (!contractState || !('result' in contractState)) {
        return null;
      }

      return {
        owner: contractState.result?.retval?.toString() ?? '',
        name: '',
        status: 'unknown',
        metadataCid: null,
        lastLedgerSeq: 0,
      };
    } catch (err) {
      this.logger.warn(`Failed to fetch project registry from ${contractId}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async checkAccountExists(publicKey: string): Promise<boolean> {
    return this.stellarService.accountExists(publicKey);
  }

  async fetchLatestLedger(): Promise<number | null> {
    try {
      const latest = await this.sorobanRpc.rawServer.getLatestLedger();
      return latest.sequence;
    } catch {
      return null;
    }
  }
}
