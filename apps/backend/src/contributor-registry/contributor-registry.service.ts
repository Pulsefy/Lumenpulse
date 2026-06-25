import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  Keypair,
  Account,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  nativeToScVal,
  Address,
  xdr,
  rpc,
  StrKey,
} from '@stellar/stellar-sdk';
import { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';
import { CacheService } from '../cache/cache.service';
import { config } from '../lib/config';

/** Cache TTL for reputation reads: 60 s. Hot path, changes infrequently. */
const REPUTATION_TTL_MS = 60_000;
/** Cache TTL for contributor profile reads: 30 s. */
const CONTRIBUTOR_TTL_MS = 30_000;

const NETWORK_PASSPHRASE =
  config.stellar.network === 'mainnet'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015';

export interface ContributorData {
  address: string;
  githubHandle: string;
  reputationScore: number;
  registeredTimestamp: number;
}

@Injectable()
export class ContributorRegistryService {
  private readonly logger = new Logger(ContributorRegistryService.name);

  constructor(
    private readonly sorobanRpc: SorobanRpcClientService,
    private readonly cache: CacheService,
  ) {}

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Register a contributor on-chain using the server keypair to pay fees.
   * Calls `register_contributor(address, github_handle)` — the signer is the
   * server, so `address.require_auth()` is satisfied by including the server
   * as the source and signer.  On testnet this is fine for seeding / admin use.
   */
  async register(address: string, githubHandle: string): Promise<{ txHash: string; status: string }> {
    const contractId = config.stellar.contracts.contributorRegistry;
    if (!contractId) {
      throw new BadRequestException('STELLAR_CONTRACT_CONTRIBUTOR_REGISTRY is not configured');
    }

    const keypair = Keypair.fromSecret(config.stellar.serverSecret.reveal());
    const account = await this.sorobanRpc.getAccount(keypair.publicKey());

    const tx = new TransactionBuilder(
      new Account(account.accountId(), account.sequenceNumber()),
      { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE },
    )
      .addOperation(
        new Contract(contractId).call(
          'register_contributor',
          new Address(address).toScVal(),
          nativeToScVal(githubHandle, { type: 'string' }),
        ),
      )
      .setTimeout(30)
      .build();

    const sim = await this.sorobanRpc.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new BadRequestException(`Simulation failed: ${sim.error}`);
    }

    const assembled = rpc.assembleTransaction(tx, sim).build();
    assembled.sign(keypair);

    const result = await this.sorobanRpc.sendTransaction(assembled);
    this.logger.log(`Registered contributor ${address} → tx ${result.hash}`);

    // Bust cached profile if it existed
    await this.cache.del(`contributor:addr:${address}`);

    return { txHash: result.hash, status: result.status };
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  async getByAddress(address: string): Promise<ContributorData> {
    return this.cache.getOrSet(
      `contributor:addr:${address}`,
      () => this.simulateGetContributor('get_contributor', new Address(address).toScVal()),
      CONTRIBUTOR_TTL_MS,
    );
  }

  async getByGithub(githubHandle: string): Promise<ContributorData> {
    return this.cache.getOrSet(
      `contributor:github:${githubHandle}`,
      () => this.simulateGetContributor('get_contributor_by_github', nativeToScVal(githubHandle, { type: 'string' })),
      CONTRIBUTOR_TTL_MS,
    );
  }

  async getReputation(address: string): Promise<{ address: string; reputationScore: number }> {
    const score = await this.cache.getOrSet(
      `contributor:reputation:${address}`,
      () => this.simulateReputation(address),
      REPUTATION_TTL_MS,
    );
    return { address, reputationScore: score };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private contractId(): string {
    const id = config.stellar.contracts.contributorRegistry;
    if (!id) throw new BadRequestException('STELLAR_CONTRACT_CONTRIBUTOR_REGISTRY is not configured');
    return id;
  }

  private async simulate(method: string, ...args: xdr.ScVal[]): Promise<xdr.ScVal> {
    const keypair = Keypair.fromSecret(config.stellar.serverSecret.reveal());
    const account = await this.sorobanRpc.getAccount(keypair.publicKey());

    const tx = new TransactionBuilder(
      new Account(account.accountId(), account.sequenceNumber()),
      { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE },
    )
      .addOperation(new Contract(this.contractId()).call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.sorobanRpc.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new NotFoundException(`Contract call failed: ${sim.error}`);
    }

    const result = (sim as rpc.Api.SimulateTransactionSuccessResponse).result;
    if (!result) throw new InternalServerErrorException('Empty simulation result');
    return result.retval;
  }

  private async simulateGetContributor(method: string, arg: xdr.ScVal): Promise<ContributorData> {
    const retval = await this.simulate(method, arg);
    return this.decodeContributorData(retval);
  }

  private async simulateReputation(address: string): Promise<number> {
    const retval = await this.simulate('get_reputation', new Address(address).toScVal());
    if (retval.switch().value === xdr.ScValType.scvU64().value) {
      return Number(retval.u64());
    }
    return 0;
  }

  /**
   * Decode a `ContributorData` ScvMap returned by the contract.
   * Field order matches the Rust struct: address, github_handle, reputation_score, registered_timestamp.
   */
  private decodeContributorData(val: xdr.ScVal): ContributorData {
    if (val.switch().value !== xdr.ScValType.scvMap().value) {
      throw new InternalServerErrorException('Unexpected contract return type');
    }
    const map = new Map<string, xdr.ScVal>();
    for (const entry of val.map() ?? []) {
      const key = entry.key();
      if (key.switch().value === xdr.ScValType.scvSymbol().value) {
        map.set(key.sym().toString(), entry.val());
      }
    }

    const getString = (k: string) => {
      const v = map.get(k);
      return v?.switch().value === xdr.ScValType.scvString().value
        ? v.str().toString()
        : '';
    };
    const getU64 = (k: string) => {
      const v = map.get(k);
      return v?.switch().value === xdr.ScValType.scvU64().value ? Number(v.u64()) : 0;
    };
    const getAddress = (k: string) => {
      const v = map.get(k);
      if (!v || v.switch().value !== xdr.ScValType.scvAddress().value) return '';
      const addr = v.address();
      if (addr.switch().value === xdr.ScAddressType.scAddressTypeAccount().value) {
        return StrKey.encodeEd25519PublicKey(addr.accountId().ed25519());
      }
      return '';
    };

    return {
      address: getAddress('address'),
      githubHandle: getString('github_handle'),
      reputationScore: getU64('reputation_score'),
      registeredTimestamp: getU64('registered_timestamp'),
    };
  }
}
