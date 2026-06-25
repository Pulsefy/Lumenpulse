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
  VestingWalletNotConfiguredException,
  VestingWalletRpcUnavailableException,
  VestingWalletTransactionFailedException,
} from './exceptions/vesting-wallet.exceptions';
import { toVestingWalletException } from './vesting-error.util';
import { RawVestingData } from './vesting-stream.util';
import { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';

const NETWORK_PASSPHRASES = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
} as const;

const TX_CONFIRMATION_TIMEOUT_MS = 30_000;
const TX_POLL_INTERVAL_MS = 1_500;
const BASE_INCLUSION_FEE = '1000000';

export interface CreateVestingParams {
  beneficiary: string;
  amount: string;
  startTime: number;
  duration: number;
}

export interface CreateVestingWithMilestoneParams extends CreateVestingParams {
  vaultContract: string;
  projectId: number;
  milestoneId: number;
}

export interface SubmittedTransaction {
  hash: string;
  status: 'SUCCESS';
  ledger?: number;
}

@Injectable()
export class VestingWalletSorobanClient {
  private readonly logger = new Logger(VestingWalletSorobanClient.name);

  constructor(
    private readonly sorobanRpc: SorobanRpcClientService,
  ) {}

  private getContractId(): string {
    const contractId = config.stellar.contracts.contributorRegistry;
    if (!contractId || !StrKey.isValidContract(contractId)) {
      throw new VestingWalletNotConfiguredException();
    }
    return contractId;
  }

  private getNetworkPassphrase(): string {
    return NETWORK_PASSPHRASES[config.stellar.network];
  }

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

  async createVesting(
    params: CreateVestingParams,
  ): Promise<SubmittedTransaction> {
    const contractId = this.getContractId();
    this.validateAddressOrThrow(params.beneficiary, 'beneficiary');

    const keypair = this.getAdminKeypair();

    try {
      const sourceAccount = await this.sorobanRpc.getAccount(keypair.publicKey());
      const contract = new Contract(contractId);

      const operation = contract.call(
        'create_vesting',
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

      const simulation = await this.sorobanRpc.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simulation)) {
        const simError = simulation.error;
        throw toVestingWalletException(
          typeof simError === 'string' ? simError : String(simError),
          params.beneficiary,
        );
      }

      const prepared = rpc.assembleTransaction(tx, simulation).build();
      prepared.sign(keypair);

      return await this.submitAndConfirm(prepared);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async createVestingWithMilestone(
    params: CreateVestingWithMilestoneParams,
  ): Promise<SubmittedTransaction> {
    const contractId = this.getContractId();
    this.validateAddressOrThrow(params.beneficiary, 'beneficiary');
    this.validateAddressOrThrow(params.vaultContract, 'vaultContract');

    const keypair = this.getAdminKeypair();

    try {
      const sourceAccount = await this.sorobanRpc.getAccount(keypair.publicKey());
      const contract = new Contract(contractId);

      const milestoneLinkScVal = xdr.ScVal.scvVec([
        Address.fromString(params.vaultContract).toScVal(),
        nativeToScVal(BigInt(params.projectId), { type: 'u64' }),
        nativeToScVal(BigInt(params.milestoneId), { type: 'u32' }),
      ]);

      const operation = contract.call(
        'create_vesting_with_milestone',
        Address.fromString(keypair.publicKey()).toScVal(),
        Address.fromString(params.beneficiary).toScVal(),
        nativeToScVal(BigInt(params.amount), { type: 'i128' }),
        nativeToScVal(BigInt(params.startTime), { type: 'u64' }),
        nativeToScVal(BigInt(params.duration), { type: 'u64' }),
        milestoneLinkScVal,
      );

      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_INCLUSION_FEE,
        networkPassphrase: this.getNetworkPassphrase(),
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const simulation = await this.sorobanRpc.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simulation)) {
        const simError = simulation.error;
        throw toVestingWalletException(
          typeof simError === 'string' ? simError : String(simError),
          params.beneficiary,
        );
      }

      const prepared = rpc.assembleTransaction(tx, simulation).build();
      prepared.sign(keypair);

      return await this.submitAndConfirm(prepared);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async getVesting(beneficiary: string): Promise<RawVestingData | null> {
    const contractId = this.getContractId();
    this.validateAddressOrThrow(beneficiary, 'beneficiary');

    try {
      const ledgerKey = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: Address.fromString(contractId).toScAddress(),
          key: xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('Vesting'),
            Address.fromString(beneficiary).toScVal(),
          ]),
          durability: xdr.ContractDataDurability.persistent(),
        }),
      );

      const response = await this.sorobanRpc.getLedgerEntries(ledgerKey);
      if (response.entries.length === 0) {
        return null;
      }

      const scVal = response.entries[0].val.contractData().val();
      return this.decodeVestingData(scVal);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  async getClaimable(beneficiary: string): Promise<bigint> {
    const contractId = this.getContractId();
    this.validateAddressOrThrow(beneficiary, 'beneficiary');

    try {
      const contract = new Contract(contractId);
      const operation = contract.call(
        'get_claimable',
        Address.fromString(beneficiary).toScVal(),
      );

      const sourceAccount = await this.sorobanRpc.getAccount(
        this.getAdminKeypair().publicKey(),
      );
      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_INCLUSION_FEE,
        networkPassphrase: this.getNetworkPassphrase(),
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const simulation = await this.sorobanRpc.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simulation)) {
        const simError = simulation.error;
        throw toVestingWalletException(
          typeof simError === 'string' ? simError : String(simError),
          beneficiary,
        );
      }

      const claimable = scValToNative(simulation.result!.retval) as bigint;
      return claimable;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  private decodeVestingData(scVal: xdr.ScVal): RawVestingData {
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
      throw new VestingWalletNotConfiguredException();
    }
  }

  private normalizeError(
    error: unknown,
  ): VestingWalletRpcUnavailableException | Error {
    if (
      error &&
      typeof error === 'object' &&
      'getStatus' in error &&
      typeof (error as { getStatus: unknown }).getStatus === 'function'
    ) {
      return error as unknown as Error;
    }

    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`Soroban RPC error: ${message}`);
    return new VestingWalletRpcUnavailableException(message);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async submitAndConfirm(
    transaction: ReturnType<TransactionBuilder['build']>,
  ): Promise<SubmittedTransaction> {
    const sendResponse = await this.sorobanRpc.sendTransaction(transaction);

    if (sendResponse.status === 'ERROR') {
      throw new VestingWalletTransactionFailedException(
        'Transaction was rejected by the network',
        { sendStatus: sendResponse.status },
      );
    }

    const hash = sendResponse.hash;
    const deadline = Date.now() + TX_CONFIRMATION_TIMEOUT_MS;
    let getResponse = await this.sorobanRpc.getTransaction(hash);

    while (
      getResponse.status === rpc.Api.GetTransactionStatus.NOT_FOUND &&
      Date.now() < deadline
    ) {
      await this.sleep(TX_POLL_INTERVAL_MS);
      getResponse = await this.sorobanRpc.getTransaction(hash);
    }

    if (getResponse.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash, status: 'SUCCESS', ledger: getResponse.ledger };
    }

    if (getResponse.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      throw new VestingWalletTransactionFailedException(
        'Transaction was not confirmed within the timeout window',
        { transactionHash: hash },
      );
    }

    throw new VestingWalletTransactionFailedException(
      'Transaction failed on-chain',
      { transactionHash: hash, getStatus: getResponse.status },
    );
  }
}

