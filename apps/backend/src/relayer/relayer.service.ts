import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Keypair,
  Networks,
  TransactionBuilder,
  Transaction,
  BASE_FEE,
  Account,
  Contract,
  xdr,
  rpc,
  nativeToScVal,
  Address,
} from '@stellar/stellar-sdk';
import { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';
import { RelayIntentDto } from './dto/relay-intent.dto';

export interface RelayResult {
  txHash: string;
  status: string;
}

@Injectable()
export class RelayerService {
  private readonly logger = new Logger(RelayerService.name);
  private readonly relayerKeypair: Keypair;
  private readonly networkPassphrase: string;
  private readonly contributorRegistryContractId: string;
  private readonly curationContractId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly sorobanRpc: SorobanRpcClientService,
  ) {
    const relayerSecret = this.configService.get<string>('RELAYER_SECRET');
    if (!relayerSecret) {
      throw new Error('RELAYER_SECRET env var is required for the relayer');
    }
    this.relayerKeypair = Keypair.fromSecret(relayerSecret);

    const network = this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    this.contributorRegistryContractId = this.configService.get<string>(
      'CONTRIBUTOR_REGISTRY_CONTRACT_ID',
      '',
    );
    this.curationContractId = this.configService.get<string>(
      'CURATION_CONTRACT_ID',
      '',
    );
  }

  /**
   * Read the current `RegistrationNonce` for a given address by simulating
   * `get_registration_nonce` on the contributor registry contract.
   */
  async getRegistrationNonce(
    publicKey: string,
    contractId: string,
  ): Promise<number> {
    try {
      const relayerAccount = await this.sorobanRpc.getAccount(
        this.relayerKeypair.publicKey(),
      );
      const contract = new Contract(contractId);
      const tx = new TransactionBuilder(relayerAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'get_registration_nonce',
            new Address(publicKey).toScVal(),
          ),
        )
        .setTimeout(30)
        .build();

      const sim = await this.sorobanRpc.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) return 0;
      const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result;
      if (!result) return 0;
      const val = result.retval;
      if (val.switch().value === xdr.ScValType.scvU64().value) {
        return Number(val.u64());
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Accept a user's signed `SorobanAuthorizationEntry`, attach it to a
   * relayer-funded transaction, and submit it on-chain.
   *
   * The user never pays fees — the relayer keypair covers them.
   */
  async relayIntent(dto: RelayIntentDto): Promise<RelayResult> {
    const { intentType, signedAuthEntryXdr, userPublicKey, payload } = dto;

    // Decode the auth entry supplied by the user's wallet.
    let authEntry: xdr.SorobanAuthorizationEntry;
    try {
      authEntry = xdr.SorobanAuthorizationEntry.fromXDR(
        signedAuthEntryXdr,
        'base64',
      );
    } catch {
      throw new BadRequestException('Invalid signedAuthEntryXdr: cannot parse XDR');
    }

    // Build the contract invocation matching the intent type.
    const { contractId, operation } = this.buildOperation(
      intentType,
      userPublicKey,
      payload,
    );

    // Load the relayer's account for sequence-number management.
    let relayerAccount: Account;
    try {
      relayerAccount = await this.sorobanRpc.getAccount(
        this.relayerKeypair.publicKey(),
      );
    } catch {
      throw new InternalServerErrorException(
        'Failed to load relayer account from Soroban RPC',
      );
    }

    // Build an unsigned transaction from the relayer's account.
    const tx = new TransactionBuilder(relayerAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    // Simulate to get the resource footprint & fee estimate.
    let simResult: rpc.Api.SimulateTransactionResponse;
    try {
      simResult = await this.sorobanRpc.simulateTransaction(tx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(`Simulation failed: ${msg}`);
    }

    if (rpc.Api.isSimulationError(simResult)) {
      throw new BadRequestException(
        `Simulation error for contract ${contractId}: ${simResult.error}`,
      );
    }

    // Assemble the transaction with the simulation's resource footprint & fee,
    // then replace the auto-generated auth entries with the user-signed entry.
    const assembledTx = rpc.assembleTransaction(tx, simResult).build();

    // Mutate the auth list on the invokeHostFunction operation in the XDR
    // envelope so the Soroban host verifies the user's Ed25519 signature
    // instead of requiring the user to sign the full transaction envelope.
    const txEnv = assembledTx.toEnvelope();
    for (const op of txEnv.v1().tx().operations()) {
      const body = op.body();
      if (body.switch().value === xdr.OperationType.invokeHostFunction().value) {
        body.invokeHostFunction().auth([authEntry]);
        break;
      }
    }

    // Reconstruct a Transaction from the mutated envelope so we can sign it.
    const finalTx = new Transaction(txEnv.toXDR('base64'), this.networkPassphrase);

    // Relayer signs and pays.
    finalTx.sign(this.relayerKeypair);

    const sendResult = await this.sorobanRpc.sendTransaction(finalTx);
    this.logger.log(
      `Relayed ${intentType} for ${userPublicKey} → tx ${sendResult.hash}`,
    );

    return { txHash: sendResult.hash, status: sendResult.status };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private buildOperation(
    intentType: RelayIntentDto['intentType'],
    userPublicKey: string,
    payload: string,
  ): { contractId: string; operation: ReturnType<Contract['call']> } {
    switch (intentType) {
      case 'register_contributor': {
        const contractId = this.contributorRegistryContractId;
        if (!contractId) {
          throw new BadRequestException(
            'CONTRIBUTOR_REGISTRY_CONTRACT_ID is not configured',
          );
        }
        const contract = new Contract(contractId);
        // Matches register_contributor_with_sig(github_handle, address, signature)
        // The signature arg here is a placeholder — real auth is via the
        // SorobanAuthorizationEntry injected into the tx auth list.
        const operation = contract.call(
          'register_contributor_with_sig',
          nativeToScVal(payload, { type: 'string' }),      // github_handle
          new Address(userPublicKey).toScVal(),              // address
          nativeToScVal(Buffer.alloc(64, 0), { type: 'bytes' }), // signature placeholder
        );
        return { contractId, operation };
      }

      case 'propose_project': {
        const contractId = this.curationContractId;
        if (!contractId) {
          throw new BadRequestException('CURATION_CONTRACT_ID is not configured');
        }
        let metadata: Record<string, string>;
        try {
          metadata = JSON.parse(payload) as Record<string, string>;
        } catch {
          throw new BadRequestException(
            'payload must be valid JSON for propose_project intent',
          );
        }
        const contract = new Contract(contractId);
        const metadataScVal = xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: nativeToScVal('name', { type: 'string' }),
            val: nativeToScVal(metadata.name ?? '', { type: 'string' }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal('description', { type: 'string' }),
            val: nativeToScVal(metadata.description ?? '', { type: 'string' }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal('url', { type: 'string' }),
            val: nativeToScVal(metadata.url ?? '', { type: 'string' }),
          }),
          new xdr.ScMapEntry({
            key: nativeToScVal('funding_address', { type: 'string' }),
            val: new Address(metadata.funding_address ?? userPublicKey).toScVal(),
          }),
        ]);
        const operation = contract.call(
          'propose_project',
          new Address(userPublicKey).toScVal(),
          metadataScVal,
        );
        return { contractId, operation };
      }

      default:
        throw new BadRequestException(`Unknown intentType: ${String(intentType)}`);
    }
  }
}
