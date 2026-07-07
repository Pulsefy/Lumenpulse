import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  SorobanRpcError,
  SorobanErrorCode,
} from '../stellar/services/soroban-rpc-client.service';
import { CacheService } from '../cache/cache.service';
import { config } from '../lib/config';
import { SorobanRpcClientService } from '../stellar/services/soroban-rpc-client.service';
import {
  ContributorResponseDto,
  NonceResponseDto,
  RegisterContributorDto,
  RegisterWithSigDto,
  RegistrationXdrResponseDto,
  ReputationResponseDto,
  SubmitResponseDto,
} from './dto/contributor-registry.dto';

const CONTRIBUTOR_CACHE_TTL = 60_000; // 1 minute — profiles change infrequently
const REPUTATION_CACHE_TTL = 60_000; // 1 minute — can change via on_notify but short enough
const NONCE_CACHE_TTL = 5_000; // 5 seconds — time-sensitive for off-chain signing

const CACHE_PREFIX_ADDRESS = 'contributor-registry:address';
const CACHE_PREFIX_GITHUB = 'contributor-registry:github';
const CACHE_PREFIX_REPUTATION = 'contributor-registry:reputation';
const CACHE_PREFIX_NONCE = 'contributor-registry:nonce';

interface MockContributor {
  address: string;
  githubHandle: string;
  reputationScore: number;
  registeredAt: string;
}

@Injectable()
export class ContributorRegistryService {
  private readonly logger = new Logger(ContributorRegistryService.name);

  // In-memory store used when USE_MOCK_TRANSACTIONS=true (default in development)
  private readonly mockContributors = new Map<string, MockContributor>();
  private readonly mockGithubIndex = new Map<string, string>(); // lowercase handle → address
  private readonly mockNonces = new Map<string, number>(); // address → nonce

  constructor(
    private readonly cacheService: CacheService,
    private readonly sorobanRpcClient: SorobanRpcClientService,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private get useMock(): boolean {
    return config.featureFlags.useMockTransactions;
  }

  private get contractId(): string | null {
    return config.stellar.contracts.contributorRegistry;
  }

  private get networkPassphrase(): string {
    return config.stellar.network === 'mainnet'
      ? Networks.PUBLIC
      : Networks.TESTNET;
  }

  private tierFromScore(score: number): string {
    if (score >= 100) return 'Core';
    if (score >= 50) return 'Architect';
    if (score >= 10) return 'Builder';
    return 'Novice';
  }

  private requireContractId(): string {
    const id = this.contractId;
    if (!id) {
      throw new BadRequestException(
        'Contributor registry contract address is not configured (STELLAR_CONTRACT_CONTRIBUTOR_REGISTRY)',
      );
    }
    return id;
  }

  private relayerKeypair(): Keypair {
    return Keypair.fromSecret(config.stellar.serverSecret.reveal());
  }

  // ── Registration ─────────────────────────────────────────────────────────────

  /**
   * Direct registration — requires the contributor's own authorization.
   *
   * Mock mode: stores the contributor immediately and returns a placeholder XDR.
   * Real mode: builds an unsigned Soroban transaction and returns the XDR for
   * the contributor to sign with their Stellar wallet before submitting.
   */
  async buildRegistrationXdr(
    dto: RegisterContributorDto,
  ): Promise<RegistrationXdrResponseDto> {
    if (this.useMock) {
      return this.mockRegister(dto);
    }

    const contractId = this.requireContractId();
    const account = await this.sorobanRpcClient.getAccount(dto.address);
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'register_contributor',
          new Address(dto.address).toScVal(),
          nativeToScVal(dto.githubHandle, { type: 'string' }),
        ),
      )
      .setTimeout(30)
      .build();

    const simulation = await this.sorobanRpcClient.simulateTransaction(tx);
    const preparedTx = rpc.assembleTransaction(tx, simulation).build();

    return {
      unsignedXdr: preparedTx.toXDR(),
      networkPassphrase: this.networkPassphrase,
    };
  }

  /**
   * Gasless / meta-transaction registration — server acts as the relayer.
   *
   * The contributor signs a SorobanAuthorizationEntry off-chain (no XLM needed).
   * The server builds the transaction, attaches the signed entry, and submits
   * using the relayer account (STELLAR_SERVER_SECRET) which pays the fees.
   *
   * Mock mode: stores the contributor immediately and returns a mock receipt.
   */
  async registerWithSignature(
    dto: RegisterWithSigDto,
  ): Promise<SubmitResponseDto> {
    if (this.useMock) {
      return this.mockRegisterWithSig(dto);
    }

    const contractId = this.requireContractId();
    const relayer = this.relayerKeypair();
    const relayerAccount = await this.sorobanRpcClient.getAccount(
      relayer.publicKey(),
    );
    const contract = new Contract(contractId);

    // The `signature` parameter is arbitrary bytes attached for auditability;
    // the cryptographic proof lives in the SorobanAuthorizationEntry.
    const signatureBytes = dto.signatureHex
      ? Buffer.from(dto.signatureHex, 'hex')
      : Buffer.alloc(64, 0);

    const tx = new TransactionBuilder(relayerAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'register_contributor_with_sig',
          nativeToScVal(dto.githubHandle, { type: 'string' }),
          new Address(dto.address).toScVal(),
          xdr.ScVal.scvBytes(signatureBytes),
        ),
      )
      .setTimeout(30)
      .build();

    const simulation = await this.sorobanRpcClient.simulateTransaction(tx);

    // Assemble (applies resource fee and simulation-derived soroban data)
    const preparedTx = rpc.assembleTransaction(tx, simulation).build();

    // Replace the simulation's unsigned auth entry with the contributor's signed one
    const signedAuthEntry = xdr.SorobanAuthorizationEntry.fromXDR(
      dto.signedAuthEntryXdr,
      'base64',
    );
    preparedTx
      .toEnvelope()
      .v1()
      .tx()
      .operations()[0]
      .body()
      .invokeHostFunctionOp()
      .auth([signedAuthEntry]);

    // Relayer signs to authorize the fee payment
    preparedTx.sign(relayer);

    const result = await this.sorobanRpcClient.sendTransaction(preparedTx);

    this.logger.log(
      `Gasless registration submitted: address=${dto.address} handle=${dto.githubHandle} hash=${result.hash}`,
    );

    return {
      transactionHash: result.hash,
      status: result.status === 'PENDING' ? 'PENDING' : 'SUCCESS',
    };
  }

  // ── Lookups ───────────────────────────────────────────────────────────────────

  async getContributorByAddress(
    address: string,
  ): Promise<ContributorResponseDto> {
    return this.cacheService.getOrSet(
      `${CACHE_PREFIX_ADDRESS}:${address}`,
      () => this.fetchContributorByAddress(address),
      CONTRIBUTOR_CACHE_TTL,
    );
  }

  async getContributorByGithub(
    githubHandle: string,
  ): Promise<ContributorResponseDto> {
    return this.cacheService.getOrSet(
      `${CACHE_PREFIX_GITHUB}:${githubHandle.toLowerCase()}`,
      () => this.fetchContributorByGithub(githubHandle),
      CONTRIBUTOR_CACHE_TTL,
    );
  }

  // ── Reputation ────────────────────────────────────────────────────────────────

  async getReputation(address: string): Promise<ReputationResponseDto> {
    return this.cacheService.getOrSet(
      `${CACHE_PREFIX_REPUTATION}:${address}`,
      () => this.fetchReputation(address),
      REPUTATION_CACHE_TTL,
    );
  }

  // ── Nonce ─────────────────────────────────────────────────────────────────────

  async getNonce(address: string): Promise<NonceResponseDto> {
    const nonce = await this.cacheService.getOrSet(
      `${CACHE_PREFIX_NONCE}:${address}`,
      () => this.fetchNonce(address),
      NONCE_CACHE_TTL,
    );
    return { address, nonce };
  }

  // ── Private mock implementations ──────────────────────────────────────────────

  private mockRegister(
    dto: RegisterContributorDto,
  ): RegistrationXdrResponseDto {
    if (this.mockContributors.has(dto.address)) {
      throw new ConflictException(
        `Contributor ${dto.address} is already registered`,
      );
    }
    if (this.mockGithubIndex.has(dto.githubHandle.toLowerCase())) {
      throw new ConflictException(
        `GitHub handle '${dto.githubHandle}' is already taken`,
      );
    }

    this.mockContributors.set(dto.address, {
      address: dto.address,
      githubHandle: dto.githubHandle,
      reputationScore: 0,
      registeredAt: new Date().toISOString(),
    });
    this.mockGithubIndex.set(dto.githubHandle.toLowerCase(), dto.address);

    this.logger.log(
      `[mock] Registered contributor address=${dto.address} handle=${dto.githubHandle}`,
    );

    return {
      unsignedXdr: 'MOCK_UNSIGNED_XDR',
      networkPassphrase: this.networkPassphrase,
    };
  }

  private mockRegisterWithSig(dto: RegisterWithSigDto): SubmitResponseDto {
    if (this.mockContributors.has(dto.address)) {
      throw new ConflictException(
        `Contributor ${dto.address} is already registered`,
      );
    }
    if (this.mockGithubIndex.has(dto.githubHandle.toLowerCase())) {
      throw new ConflictException(
        `GitHub handle '${dto.githubHandle}' is already taken`,
      );
    }

    const nonce = this.mockNonces.get(dto.address) ?? 0;
    this.mockContributors.set(dto.address, {
      address: dto.address,
      githubHandle: dto.githubHandle,
      reputationScore: 0,
      registeredAt: new Date().toISOString(),
    });
    this.mockGithubIndex.set(dto.githubHandle.toLowerCase(), dto.address);
    this.mockNonces.set(dto.address, nonce + 1);

    this.logger.log(
      `[mock] Gasless-registered contributor address=${dto.address} handle=${dto.githubHandle}`,
    );

    return {
      transactionHash: `mock_tx_${Date.now()}`,
      status: 'SUCCESS',
      ledger: Math.floor(Math.random() * 1_000_000) + 50_000_000,
    };
  }

  // ── Private real-chain fetchers ────────────────────────────────────────────────

  private async fetchContributorByAddress(
    address: string,
  ): Promise<ContributorResponseDto> {
    if (this.useMock) {
      const contributor = this.mockContributors.get(address);
      if (!contributor) {
        throw new NotFoundException(
          `Contributor with address ${address} not found`,
        );
      }
      return {
        ...contributor,
        tier: this.tierFromScore(contributor.reputationScore),
      };
    }

    const contractId = this.requireContractId();
    const relayer = this.relayerKeypair();
    const account = await this.sorobanRpcClient.getAccount(relayer.publicKey());
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call('get_contributor', new Address(address).toScVal()),
      )
      .setTimeout(30)
      .build();

    let simulation: rpc.Api.SimulateTransactionResponse;
    try {
      simulation = await this.sorobanRpcClient.simulateTransaction(tx);
    } catch (err) {
      if (
        err instanceof SorobanRpcError &&
        err.code === SorobanErrorCode.SIMULATION_FAILED
      ) {
        throw new NotFoundException(
          `Contributor with address ${address} not found`,
        );
      }
      throw err;
    }

    if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
      throw new NotFoundException(
        `Contributor with address ${address} not found`,
      );
    }

    return this.parseContributorData(simulation.result.retval);
  }

  private async fetchContributorByGithub(
    githubHandle: string,
  ): Promise<ContributorResponseDto> {
    if (this.useMock) {
      const address = this.mockGithubIndex.get(githubHandle.toLowerCase());
      if (!address) {
        throw new NotFoundException(
          `Contributor with GitHub handle '${githubHandle}' not found`,
        );
      }
      // Re-use the address fetcher (no extra network call in mock mode)
      return this.fetchContributorByAddress(address);
    }

    const contractId = this.requireContractId();
    const relayer = this.relayerKeypair();
    const account = await this.sorobanRpcClient.getAccount(relayer.publicKey());
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'get_contributor_by_github',
          nativeToScVal(githubHandle, { type: 'string' }),
        ),
      )
      .setTimeout(30)
      .build();

    let simulation: rpc.Api.SimulateTransactionResponse;
    try {
      simulation = await this.sorobanRpcClient.simulateTransaction(tx);
    } catch (err) {
      if (
        err instanceof SorobanRpcError &&
        err.code === SorobanErrorCode.SIMULATION_FAILED
      ) {
        throw new NotFoundException(
          `Contributor with GitHub handle '${githubHandle}' not found`,
        );
      }
      throw err;
    }

    if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
      throw new NotFoundException(
        `Contributor with GitHub handle '${githubHandle}' not found`,
      );
    }

    return this.parseContributorData(simulation.result.retval);
  }

  private async fetchReputation(
    address: string,
  ): Promise<ReputationResponseDto> {
    if (this.useMock) {
      const contributor = this.mockContributors.get(address);
      if (!contributor) {
        throw new NotFoundException(
          `Contributor with address ${address} not found`,
        );
      }
      return {
        address,
        reputationScore: contributor.reputationScore,
        tier: this.tierFromScore(contributor.reputationScore),
      };
    }

    const contractId = this.requireContractId();
    const relayer = this.relayerKeypair();
    const account = await this.sorobanRpcClient.getAccount(relayer.publicKey());
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call('get_reputation', new Address(address).toScVal()),
      )
      .setTimeout(30)
      .build();

    let simulation: rpc.Api.SimulateTransactionResponse;
    try {
      simulation = await this.sorobanRpcClient.simulateTransaction(tx);
    } catch (err) {
      if (
        err instanceof SorobanRpcError &&
        err.code === SorobanErrorCode.SIMULATION_FAILED
      ) {
        throw new NotFoundException(
          `Contributor with address ${address} not found`,
        );
      }
      throw err;
    }

    if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
      throw new NotFoundException(
        `Contributor with address ${address} not found`,
      );
    }

    const score = Number(scValToNative(simulation.result.retval) as bigint);

    return { address, reputationScore: score, tier: this.tierFromScore(score) };
  }

  private async fetchNonce(address: string): Promise<number> {
    if (this.useMock) {
      return this.mockNonces.get(address) ?? 0;
    }

    const contractId = this.contractId;
    if (!contractId) {
      return 0;
    }

    const relayer = this.relayerKeypair();
    const account = await this.sorobanRpcClient.getAccount(relayer.publicKey());
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call('get_registration_nonce', new Address(address).toScVal()),
      )
      .setTimeout(30)
      .build();

    try {
      const simulation = await this.sorobanRpcClient.simulateTransaction(tx);

      if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
        return 0;
      }

      return Number(scValToNative(simulation.result.retval) as bigint);
    } catch {
      // Not initialized or address has no nonce yet — safe default
      return 0;
    }
  }

  // ── XDR parsers ────────────────────────────────────────────────────────────────

  private parseContributorData(retval: xdr.ScVal): ContributorResponseDto {
    const data = scValToNative(retval) as {
      address: string;
      github_handle: string;
      reputation_score: bigint;
      registered_timestamp: bigint;
    };

    const score = Number(data.reputation_score);

    return {
      address: data.address,
      githubHandle: data.github_handle,
      reputationScore: score,
      tier: this.tierFromScore(score),
      // Soroban timestamps are Unix seconds; convert to ISO string
      registeredAt: new Date(
        Number(data.registered_timestamp) * 1000,
      ).toISOString(),
    };
  }
}
