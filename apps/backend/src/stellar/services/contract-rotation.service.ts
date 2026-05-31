import { Injectable } from '@nestjs/common';
import {
  StrKey,
  Contract,
  Keypair,
  Account,
  TransactionBuilder,
  BASE_FEE,
  rpc,
} from '@stellar/stellar-sdk';
import { config } from '../../lib/config';
import { ContractValidationResultDto } from '../dto/rotate-contract-ids.dto';

const NETWORK_PASSPHRASES = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015',
} as const;

const DEFAULT_SOROBAN_RPC_URLS = {
  testnet: 'https://soroban-testnet.stellar.org',
  mainnet: 'https://soroban.stellar.org',
} as const;

/**
 * Defines which read methods are called to validate each contract type.
 * These methods are safe to call and verify the contract exists and is callable.
 */
const CONTRACT_VALIDATION_METHODS: Record<string, string[]> = {
  lumenToken: ['decimals'],
  crowdfundVault: ['get_admin'],
  projectRegistry: ['get_admin'],
  contributorRegistry: ['get_multisig_config'],
  matchingPool: ['get_admin'],
  treasury: ['get_admin'],
} as const;

type ContractName = keyof typeof CONTRACT_VALIDATION_METHODS;

interface SimulationContext {
  server: rpc.Server;
  sourceAccountId: string;
  sourceSequence: string;
  networkPassphrase: string;
}

@Injectable()
export class ContractRotationService {
  /**
   * Validates that new contract IDs are reachable and callable on the network.
   * Performs read-only simulation transactions to verify the contracts exist
   * and respond correctly.
   *
   * @param contractIds - Map of contract names to IDs to validate
   * @param network - Network to validate against ('testnet' or 'mainnet')
   * @returns Validation results for each contract
   * @throws BadRequestException - If any contract ID is invalid or unreachable
   */
  async validateContractIds(
    contractIds: Partial<Record<ContractName, string>>,
    network: 'testnet' | 'mainnet' = 'testnet',
  ): Promise<ContractValidationResultDto[]> {
    const results: ContractValidationResultDto[] = [];

    // Basic format validation first
    for (const [name, id] of Object.entries(contractIds)) {
      if (!id) {
        continue;
      }

      if (!StrKey.isValidContract(id)) {
        results.push({
          name,
          isValid: false,
          error: `Invalid contract ID format: ${id}`,
        });
      }
    }

    // Continue to on-chain validation for IDs that passed format checks.
    // Format errors are already recorded in `results` and will be
    // returned alongside on-chain validation results.

    // Load simulation context for on-chain validation
    let context: SimulationContext | null = null;
    try {
      context = await this.loadSimulationContext(network);
    } catch {
      // If we can't load the context, continue but mark on-chain
      // validation as unavailable. Do not throw — tests and callers
      // should receive format validation results even when RPC is down.
      context = null;
    }

    // Prepare set of names that already failed format validation
    const formatErrorNames = new Set(
      results.filter((r) => !r.isValid).map((r) => r.name),
    );

    // Validate each contract by simulating a read call
    for (const [name, id] of Object.entries(contractIds)) {
      if (!id) {
        continue;
      }

      // Skip on-chain validation for entries that already failed format checks
      if (formatErrorNames.has(name)) {
        continue;
      }

      try {
        if (!context) {
          // Can't perform on-chain simulation; report as not validated
          results.push({
            name,
            isValid: false,
            error: 'Soroban RPC unavailable',
          });
          continue;
        }
        const methods = CONTRACT_VALIDATION_METHODS[name] || ['get_admin'];
        let methodValid = false;
        let lastError: string | undefined;

        // Try each validation method
        for (const method of methods) {
          try {
            await this.simulateContractRead(context, id, method);
            methodValid = true;
            break; // Success, no need to try other methods
          } catch (methodError) {
            lastError =
              methodError instanceof Error
                ? methodError.message
                : String(methodError);
          }
        }

        if (methodValid) {
          results.push({
            name,
            isValid: true,
          });
        } else {
          results.push({
            name,
            isValid: false,
            error: `Contract not callable: ${lastError}`,
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({
          name,
          isValid: false,
          error: errorMsg,
        });
      }
    }

    return results;
  }

  /**
   * Loads the simulation context needed to validate contracts.
   * Uses the configured Soroban RPC URL and server secret to create
   * a context for transaction simulation.
   *
   * @param network - Network to load context for
   * @returns SimulationContext with RPC server and account details
   * @throws Error - If unable to connect or load account
   */
  private async loadSimulationContext(
    network: 'testnet' | 'mainnet',
  ): Promise<SimulationContext> {
    const sorobanRpcUrl = this.getSorobanRpcUrl(network);

    const server = new rpc.Server(sorobanRpcUrl, {
      timeout: config.stellar.timeout,
      allowHttp: sorobanRpcUrl.startsWith('http://'),
    });

    const sourcePublicKey = Keypair.fromSecret(
      config.stellar.serverSecret.reveal(),
    ).publicKey();
    const sourceAccount = await server.getAccount(sourcePublicKey);

    return {
      server,
      sourceAccountId: sourceAccount.accountId(),
      sourceSequence: sourceAccount.sequenceNumber(),
      networkPassphrase: NETWORK_PASSPHRASES[network],
    };
  }

  /**
   * Simulates a read-only contract method call to validate the contract is reachable.
   *
   * @param context - Simulation context with RPC server and account info
   * @param contractId - Contract ID to validate
   * @param method - Method name to call
   * @throws Error - If simulation fails
   */
  private async simulateContractRead(
    context: SimulationContext,
    contractId: string,
    method: string,
  ): Promise<void> {
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
      throw new Error(
        `Simulation error for method '${method}': ${simulation.error || 'Unknown error'}`,
      );
    }

    if (!simulation.result) {
      throw new Error(
        `Simulation failed for method '${method}': No result returned`,
      );
    }
  }

  /**
   * Gets the Soroban RPC URL for the specified network.
   * Uses configured URL if available, otherwise uses default.
   *
   * @param network - Network ('testnet' or 'mainnet')
   * @returns Soroban RPC URL
   */
  private getSorobanRpcUrl(network: 'testnet' | 'mainnet'): string {
    // Only use custom RPC URL for the current configured network
    if (network === config.stellar.network && config.stellar.sorobanRpcUrl) {
      return config.stellar.sorobanRpcUrl;
    }
    return DEFAULT_SOROBAN_RPC_URLS[network];
  }
}
