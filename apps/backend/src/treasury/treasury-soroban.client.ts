import { Injectable, Logger } from '@nestjs/common';
import {
  Address,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { config } from '../lib/config';
import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../common/enums/error-code.enum';
import {
  SorobanRpcError,
} from '../stellar/services/soroban-rpc-client.service';
import {
  TreasuryNotConfiguredException,
  TreasuryRpcUnavailableException,
  TreasuryTransactionFailedException,
} from './exceptions/treasury.exceptions';
import { toTreasuryException } from './treasury-error.util';
import { RawStreamData } from './treasury-stream.util';

const NETWORK_PASSPHRASES = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
} as const;

const DEFAULT_SOROBAN_RPC_URLS = {
  testnet: 'https://soroban-testnet.stellar.org',
  mainnet: 'https://soroban.stellar.org',
} as const;

/** How long to poll for transaction confirmation before giving up. */
const TX_CONFIRMATION_TIMEOUT_MS = 30_000;
/** Delay between transaction status polls. */
const TX_POLL_INTERVAL_MS = 1_500;
/**
 * Inclusion fee (stroops) for the submitted transaction. Soroban resource fees
 * are added on top of this by {@link rpc.assembleTransaction} after simulation.
 */
const BASE_INCLUSION_FEE = '1000000';

export interface AllocateBudgetParams {
  beneficiary: string;
  /** Amount in token base units, as a decimal string (i128). */
  amount: string;
  /** Unix timestamp in seconds. */
  startTime: number;
  /** Duration in seconds. */
  duration: number;
}

export interface RotateBeneficiaryParams {
  oldBeneficiary: string;
  newBeneficiary: string;
}

export interface SubmittedTransaction {
  hash: string;
  status: 'SUCCESS';
  ledger?: number;
}

/**
 * Thin client around the Soroban RPC for the treasury contract. Builds,
 * simulates, signs (with the server admin key), and submits the
 * `allocate_budget` transaction, and reads stream state from contract storage.
 */
@Injectable()
export class TreasurySorobanClient {
  private readonly logger = new Logger(TreasurySorobanClient.name);

  /** Returns the configured treasury contract id, or throws if unusable. */
  private getContractId(): string {
    const contractId = config.stellar.contracts.treasury;
    if (!contractId || !StrKey.isValidContract(contractId)) {
      throw new TreasuryNotConfiguredException();
    }
    return contractId;
  }

  private getRpcUrl(): string {
    return (
      config.stellar.sorobanRpcUrl ??
      DEFAULT_SOROBAN_RPC_URLS[config.stellar.network]
    );
  }

  private createServer(): rpc.Server {
    return new rpc.Server(this.getRpcUrl(), {
      timeout: config.stellar.timeout,
      allowHttp: config.stellar.sorobanRpcUrl?.startsWith('http://') ?? false,
    });
  }

  private getNetworkPassphrase(): string {
    return NETWORK_PASSPHRASES[config.stellar.network];
  }

  /** Validates a Stellar account or contract address, throwing a 400 if invalid. */
  validateAddressOrThrow(address: string, field: string): void {
    if (
      !StrKey.isValidEd25519PublicKey(address) &&
      !StrKey.isValidContract(address)
    ) {
      throw new BadRequestException({
        code: ErrorCode.STEL_INVALID_ADDRESS,
        message: `Invalid Stellar address for ${field}: ${address}`,
      });
    }
  }

  /**
   * Builds, signs (as the treasury admin), and submits an `allocate_budget`
   * transaction. Contract-level validation errors are surfaced during
   * simulation and mapped to the standard API error contract.
   */
  async allocateBudget(
    params: AllocateBudgetParams,
  ): Promise<SubmittedTransaction> {
    const contractId = this.getContractId();
    this.validateAddressOrThrow(params.beneficiary, 'beneficiary');

    const keypair = this.getAdminKeypair();
    const server = this.createServer();

    try {
      const sourceAccount = await server.getAccount(keypair.publicKey());

      const contract = new Contract(contractId);
      const operation = contract.call(
        'allocate_budget',
        Address.fromString(keypair.publicKey()).toScVal(),
        Address.fromString(params.beneficiary).toScVal(),
        nativeToScVal(BigInt(params.amount), { type: 'i128' }),
        nativeToScVal(BigInt(params.startTime), { type: 'u64' }),
        nativeToScVal(BigInt(params.duration), { type: 'u64' }),
      );

      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_INCLUSION_FEE,
        networkPassphrase: this.getNetworkPassphrase(),
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const simulation = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simulation)) {
        throw toTreasuryException(simulation.error, params.beneficiary);
      }

      const prepared = rpc.assembleTransaction(tx, simulation).build();
      prepared.sign(keypair);

      return await this.submitAndConfirm(server, prepared);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /**
   * Builds, signs (as the treasury admin), and submits a `rotate_beneficiary`
   * transaction. Contract-level validation errors are surfaced during
   * simulation and mapped to the standard API error contract.
   */
  async rotateBeneficiary(
    params: RotateBeneficiaryParams,
  ): Promise<SubmittedTransaction> {
    const contractId = this.getContractId();
    this.validateAddressOrThrow(params.oldBeneficiary, 'oldBeneficiary');
    this.validateAddressOrThrow(params.newBeneficiary, 'newBeneficiary');

    const keypair = this.getAdminKeypair();
    const server = this.createServer();

    try {
      const sourceAccount = await server.getAccount(keypair.publicKey());

      const contract = new Contract(contractId);
      const operation = contract.call(
        'rotate_beneficiary',
        Address.fromString(keypair.publicKey()).toScVal(),
        Address.fromString(params.oldBeneficiary).toScVal(),
        Address.fromString(params.newBeneficiary).toScVal(),
      );

      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_INCLUSION_FEE,
        networkPassphrase: this.getNetworkPassphrase(),
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const simulation = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simulation)) {
        throw toTreasuryException(simulation.error, params.oldBeneficiary);
      }

      const prepared = rpc.assembleTransaction(tx, simulation).build();
      prepared.sign(keypair);

      return await this.submitAndConfirm(server, prepared);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /** Sends a signed transaction and polls until it is confirmed or fails. */
  private async submitAndConfirm(
    server: rpc.Server,
    transaction: ReturnType<TransactionBuilder['build']>,
  ): Promise<SubmittedTransaction> {
    const sendResponse = await server.sendTransaction(transaction);

    if (sendResponse.status === 'ERROR') {
      throw new TreasuryTransactionFailedException(
        'Transaction was rejected by the network',
        { sendStatus: sendResponse.status },
      );
    }

    const hash = sendResponse.hash;
    const deadline = Date.now() + TX_CONFIRMATION_TIMEOUT_MS;
    let getResponse = await server.getTransaction(hash);

    while (
      getResponse.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
      Date.now() < deadline
    ) {
      await this.sleep(TX_POLL_INTERVAL_MS);
      getResponse = await server.getTransaction(hash);
    }

    if (getResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash, status: 'SUCCESS', ledger: getResponse.ledger };
    }

    if (getResponse.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      throw new TreasuryTransactionFailedException(
        'Transaction was not confirmed within the timeout window',
        { transactionHash: hash },
      );
    }

    throw new TreasuryTransactionFailedException(
      'Transaction failed on-chain',
      { transactionHash: hash, getStatus: getResponse.status },
    );
  }

  /**
   * Reads the stored stream for a beneficiary directly from contract storage.
   * Returns `null` when no stream exists.
   */
  async getStream(beneficiary: string): Promise<RawStreamData | null> {
    const contractId = this.getContractId();
    this.validateAddressOrThrow(beneficiary, 'beneficiary');

    const server = this.createServer();

    try {
      const ledgerKey = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: Address.fromString(contractId).toScAddress(),
          // DataKey::Stream(beneficiary) -> Vec[Symbol("Stream"), Address]
          key: xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('Stream'),
            Address.fromString(beneficiary).toScVal(),
          ]),
          durability: xdr.ContractDataDurability.persistent(),
        }),
      );

      const response = await server.getLedgerEntries(ledgerKey);
      if (response.entries.length === 0) {
        return null;
      }

      const scVal = response.entries[0].val.contractData().val();
      return this.decodeStreamData(scVal);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /** Decodes a `StreamData` ScVal into the typed shape used by the service. */
  private decodeStreamData(scVal: xdr.ScVal): RawStreamData {
    const native = scValToNative(scVal) as {
      beneficiary: string;
      total_amount: bigint;
      claimed_amount: bigint;
      start_time: bigint;
      duration: bigint;
    };

    return {
      beneficiary: native.beneficiary,
      totalAmount: BigInt(native.total_amount),
      claimedAmount: BigInt(native.claimed_amount),
      startTime: BigInt(native.start_time),
      duration: BigInt(native.duration),
    };
  }

  private getAdminKeypair(): Keypair {
    try {
      return Keypair.fromSecret(config.stellar.serverSecret.reveal());
    } catch {
      throw new TreasuryNotConfiguredException();
    }
  }

  /**
   * Passes already-mapped HTTP/treasury exceptions through unchanged, and wraps
   * any other (network/RPC) error as an RPC-unavailable error.
   */
  private normalizeError(error: unknown): Error {
    // HttpException (incl. all treasury exceptions) carry a `getStatus` method.
    if (
      error &&
      typeof error === 'object' &&
      'getStatus' in error &&
      typeof (error as { getStatus: unknown }).getStatus === 'function'
    ) {
      return error as unknown as Error;
    }

    if (error instanceof SorobanRpcError) {
      this.logger.error(`Soroban RPC error: ${error.message}`);
      return new TreasuryRpcUnavailableException(error.message, {
        sorobanCode: error.code,
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Soroban RPC error: ${message}`);
    return new TreasuryRpcUnavailableException(message);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
