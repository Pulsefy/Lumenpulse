import { Injectable } from '@nestjs/common';
import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { config } from '../lib/config';

const NETWORK_PASSPHRASES = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
} as const;

const DEFAULT_SOROBAN_RPC_URLS = {
  testnet: 'https://soroban-testnet.stellar.org',
  mainnet: 'https://soroban.stellar.org',
} as const;

const CONTRACT_CHECKS = [
  {
    name: 'lumenToken',
    envVar: 'STELLAR_CONTRACT_LUMEN_TOKEN',
    readMethods: ['decimals', 'symbol'],
  },
  {
    name: 'crowdfundVault',
    envVar: 'STELLAR_CONTRACT_CROWDFUND_VAULT',
    readMethods: ['get_admin', 'get_storage_version'],
  },
  {
    name: 'projectRegistry',
    envVar: 'STELLAR_CONTRACT_PROJECT_REGISTRY',
    readMethods: ['get_admin', 'get_config'],
  },
  {
    name: 'contributorRegistry',
    envVar: 'STELLAR_CONTRACT_CONTRIBUTOR_REGISTRY',
    readMethods: ['get_multisig_config'],
  },
  {
    name: 'matchingPool',
    envVar: 'STELLAR_CONTRACT_MATCHING_POOL',
    readMethods: ['get_admin'],
  },
  {
    name: 'treasury',
    envVar: 'STELLAR_CONTRACT_TREASURY',
    readMethods: ['get_admin', 'get_token'],
  },
] as const;

type ContractCheckDefinition = (typeof CONTRACT_CHECKS)[number];
type ContractName = ContractCheckDefinition['name'];
type ContractStatus = 'reachable' | 'misconfigured' | 'unreachable';
type ReadMethodStatus = 'ok' | 'failed' | 'restore_required';

interface SimulationContext {
  server: rpc.Server;
  sourceAccountId: string;
  sourceSequence: string;
  networkPassphrase: string;
}

export interface ContractReadMethodHealth {
  method: string;
  status: ReadMethodStatus;
  returnType?: string;
  message?: string;
}

export interface ContractHealthResult {
  name: ContractName;
  envVar: string;
  configured: boolean;
  status: ContractStatus;
  contractId?: string;
  readMethods: ContractReadMethodHealth[];
  message?: string;
}

export interface ContractHealthReport {
  status: 'ok' | 'error';
  summary: {
    total: number;
    reachable: number;
    misconfigured: number;
    unreachable: number;
  };
  network: 'testnet' | 'mainnet';
  checkedAt: string;
  contracts: ContractHealthResult[];
}

@Injectable()
export class ContractHealthService {
  async getContractHealthReport(): Promise<ContractHealthReport> {
    const context = await this.loadSimulationContextIfNeeded();
    const contracts = await Promise.all(
      CONTRACT_CHECKS.map((definition) =>
        this.checkContract(definition, context),
      ),
    );

    const summary = contracts.reduce(
      (acc, contract) => {
        acc[contract.status] += 1;
        return acc;
      },
      {
        total: contracts.length,
        reachable: 0,
        misconfigured: 0,
        unreachable: 0,
      },
    );

    return {
      status:
        summary.misconfigured === 0 && summary.unreachable === 0
          ? 'ok'
          : 'error',
      summary,
      network: config.stellar.network,
      checkedAt: new Date().toISOString(),
      contracts,
    };
  }

  private async checkContract(
    definition: ContractCheckDefinition,
    context: SimulationContext | null,
  ): Promise<ContractHealthResult> {
    const contractId = config.stellar.contracts[definition.name];

    if (!contractId) {
      return {
        name: definition.name,
        envVar: definition.envVar,
        configured: false,
        status: 'misconfigured',
        readMethods: [],
        message: `${definition.envVar} is not configured`,
      };
    }

    const redactedContractId = this.redactContractId(contractId);

    if (!StrKey.isValidContract(contractId)) {
      return {
        name: definition.name,
        envVar: definition.envVar,
        configured: true,
        status: 'misconfigured',
        contractId: '[invalid-contract-id]',
        readMethods: [],
        message: `${definition.envVar} is not a valid Stellar contract ID`,
      };
    }

    if (!context) {
      return {
        name: definition.name,
        envVar: definition.envVar,
        configured: true,
        status: 'unreachable',
        contractId: redactedContractId,
        readMethods: [],
        message: 'Soroban RPC healthcheck source account is unavailable',
      };
    }

    const readMethods = await Promise.all(
      definition.readMethods.map((method: string) =>
        this.simulateContractRead(context, contractId, method),
      ),
    );
    const sanitizedReadMethods = readMethods.map((method) => ({
      ...method,
      message: method.message
        ? this.sanitizeMessage(method.message, contractId)
        : undefined,
    }));
    const failedRead = sanitizedReadMethods.find(
      (method) => method.status !== 'ok',
    );

    return {
      name: definition.name,
      envVar: definition.envVar,
      configured: true,
      status: failedRead ? 'unreachable' : 'reachable',
      contractId: redactedContractId,
      readMethods: sanitizedReadMethods,
      message: failedRead
        ? `Read call ${failedRead.method} did not complete successfully`
        : undefined,
    };
  }

  private async loadSimulationContextIfNeeded(): Promise<SimulationContext | null> {
    const hasConfiguredContract = CONTRACT_CHECKS.some((definition) => {
      const contractId = config.stellar.contracts[definition.name];
      return contractId && StrKey.isValidContract(contractId);
    });

    if (!hasConfiguredContract) {
      return null;
    }

    try {
      return await this.loadSimulationContext();
    } catch {
      return null;
    }
  }

  private async loadSimulationContext(): Promise<SimulationContext> {
    const server = new rpc.Server(this.getSorobanRpcUrl(), {
      timeout: config.stellar.timeout,
      allowHttp: config.stellar.sorobanRpcUrl?.startsWith('http://') ?? false,
    });
    const sourcePublicKey = Keypair.fromSecret(
      config.stellar.serverSecret.reveal(),
    ).publicKey();
    const sourceAccount = await server.getAccount(sourcePublicKey);

    return {
      server,
      sourceAccountId: sourceAccount.accountId(),
      sourceSequence: sourceAccount.sequenceNumber(),
      networkPassphrase: NETWORK_PASSPHRASES[config.stellar.network],
    };
  }

  private async simulateContractRead(
    context: SimulationContext,
    contractId: string,
    method: string,
  ): Promise<ContractReadMethodHealth> {
    try {
      const tx = new TransactionBuilder(
        new Account(context.sourceAccountId, context.sourceSequence),
        {
          fee: BASE_FEE,
          networkPassphrase: context.networkPassphrase,
        },
      )
        .addOperation(new Contract(contractId).call(method))
        .setTimeout(30)
        .build();
      const simulation = await context.server.simulateTransaction(tx);

      if (rpc.Api.isSimulationError(simulation)) {
        return {
          method,
          status: 'failed',
          message: simulation.error || 'Simulation failed',
        };
      }

      if (rpc.Api.isSimulationRestore(simulation)) {
        return {
          method,
          status: 'restore_required',
          returnType: this.getReturnType(simulation.result.retval),
          message:
            'Contract data requires restoration before this read is live',
        };
      }

      if (!simulation.result) {
        return {
          method,
          status: 'failed',
          message: 'Simulation completed without a return value',
        };
      }

      return {
        method,
        status: 'ok',
        returnType: this.getReturnType(simulation.result.retval),
      };
    } catch (error) {
      return {
        method,
        status: 'failed',
        message: this.getErrorMessage(error),
      };
    }
  }

  private getSorobanRpcUrl(): string {
    return (
      config.stellar.sorobanRpcUrl ??
      DEFAULT_SOROBAN_RPC_URLS[config.stellar.network]
    );
  }

  private getReturnType(value: xdr.ScVal): string {
    return value.switch().name;
  }

  private redactContractId(contractId: string): string {
    if (contractId.length <= 12) {
      return '[invalid-contract-id]';
    }

    return `${contractId.slice(0, 6)}...${contractId.slice(-6)}`;
  }

  private sanitizeMessage(message: string, contractId: string): string {
    const redacted = message
      .replaceAll(contractId, this.redactContractId(contractId))
      .replaceAll(config.stellar.serverSecret.reveal(), '[REDACTED]');

    return redacted.length > 300 ? `${redacted.slice(0, 297)}...` : redacted;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Read call failed';
  }
}
