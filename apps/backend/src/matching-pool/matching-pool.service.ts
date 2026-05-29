import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  rpc,
  Keypair,
  Networks,
  TransactionBuilder,
  BASE_FEE,
  Account,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk';
import { CreateRoundDto } from './dto/create-round.dto';

interface RoundMockRecord {
  id: number;
  name: string;
  tokenAddress: string;
  startTime: number;
  endTime: number;
  totalPool: string;
  isFinalized: boolean;
  eligibleProjects: Set<number>;
  status: string;
}

@Injectable()
export class MatchingPoolService {
  private readonly logger = new Logger(MatchingPoolService.name);
  private readonly useMock: boolean;
  private readonly contractId: string;
  private readonly serverKeypair: Keypair | null = null;
  private readonly sorobanRpcUrl: string;
  private readonly networkPassphrase: string;

  // In-memory store for mocks
  private mockRounds = new Map<number, RoundMockRecord>();
  private mockNextRoundId = 0;

  constructor(private readonly configService: ConfigService) {
    this.useMock = this.configService.get<boolean>(
      'USE_MOCK_TRANSACTIONS',
      true,
    );
    this.contractId =
      this.configService.get<string>('STELLAR_CONTRACT_MATCHING_POOL') ||
      'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

    const network = this.configService.get<string>(
      'STELLAR_NETWORK',
      'testnet',
    );
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    this.sorobanRpcUrl =
      this.configService.get<string>('STELLAR_SOROBAN_RPC_URL') ||
      (network === 'mainnet'
        ? 'https://soroban.stellar.org'
        : 'https://soroban-testnet.stellar.org');

    const serverSecret = this.configService.get<string>(
      'STELLAR_SERVER_SECRET',
    );
    if (serverSecret) {
      try {
        this.serverKeypair = Keypair.fromSecret(serverSecret);
      } catch (err) {
        this.logger.error('Failed to parse STELLAR_SERVER_SECRET', err);
      }
    }

    this.logger.log(
      `MatchingPoolService initialized. Contract: ${this.contractId}, Mode: ${
        this.useMock ? 'MOCK' : 'ON-CHAIN'
      }`,
    );

    if (this.useMock) {
      this.seedMockData();
    }
  }

  // ── Admin Endpoints ────────────────────────────────────────────────────────

  async createRound(dto: CreateRoundDto): Promise<{
    roundId: number;
    transactionHash: string;
    status: string;
  }> {
    const startTime = Date.now();
    const action = 'CREATE_ROUND';
    const args = { ...dto };

    this.emitStructuredLog(action, 'INITIATED', args);

    if (dto.endTime <= dto.startTime) {
      const err = new BadRequestException('endTime must be after startTime');
      this.emitStructuredLog(action, 'FAILED', args, startTime, null, err);
      throw err;
    }

    if (this.useMock) {
      const roundId = this.mockNextRoundId++;
      const record: RoundMockRecord = {
        id: roundId,
        name: dto.name,
        tokenAddress: dto.tokenAddress,
        startTime: dto.startTime,
        endTime: dto.endTime,
        totalPool: '0',
        isFinalized: false,
        eligibleProjects: new Set<number>(),
        status: 'ACTIVE',
      };
      this.mockRounds.set(roundId, record);
      const txHash = `mock_tx_${Math.random().toString(36).substring(2, 15)}`;

      this.emitStructuredLog(action, 'SUCCESS', args, startTime, txHash, null, {
        roundId,
      });

      return {
        roundId,
        transactionHash: txHash,
        status: 'SUCCESS',
      };
    }

    // On-Chain Execution
    try {
      const adminAddress = this.getAdminAddressOrThrow();
      const scArgs = [
        nativeToScVal(Address.fromString(adminAddress)),
        nativeToScVal(dto.name, { type: 'symbol' }),
        nativeToScVal(Address.fromString(dto.tokenAddress)),
        nativeToScVal(BigInt(dto.startTime), { type: 'u64' }),
        nativeToScVal(BigInt(dto.endTime), { type: 'u64' }),
      ];

      const result = await this.executeOnChainTransaction(
        'create_round',
        scArgs,
      );
      const roundId = Number(scValToNative(result.retval));

      this.emitStructuredLog(
        action,
        'SUCCESS',
        args,
        startTime,
        result.txHash,
        null,
        { roundId },
      );

      return {
        roundId,
        transactionHash: result.txHash,
        status: 'SUCCESS',
      };
    } catch (error) {
      this.emitStructuredLog(action, 'FAILED', args, startTime, null, error);
      throw new BadRequestException(
        `On-chain createRound failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async approveProject(
    roundId: number,
    projectId: number,
  ): Promise<{
    transactionHash: string;
    status: string;
  }> {
    const startTime = Date.now();
    const action = 'APPROVE_PROJECT';
    const args = { roundId, projectId };

    this.emitStructuredLog(action, 'INITIATED', args);

    if (this.useMock) {
      const record = this.mockRounds.get(roundId);
      if (!record) {
        const err = new NotFoundException(`Round ${roundId} not found`);
        this.emitStructuredLog(action, 'FAILED', args, startTime, null, err);
        throw err;
      }
      if (record.isFinalized) {
        const err = new BadRequestException('Round is already finalized');
        this.emitStructuredLog(action, 'FAILED', args, startTime, null, err);
        throw err;
      }
      if (record.eligibleProjects.has(projectId)) {
        const err = new BadRequestException('Project already eligible');
        this.emitStructuredLog(action, 'FAILED', args, startTime, null, err);
        throw err;
      }

      record.eligibleProjects.add(projectId);
      const txHash = `mock_tx_${Math.random().toString(36).substring(2, 15)}`;

      this.emitStructuredLog(action, 'SUCCESS', args, startTime, txHash);

      return {
        transactionHash: txHash,
        status: 'SUCCESS',
      };
    }

    // On-Chain Execution
    try {
      const adminAddress = this.getAdminAddressOrThrow();
      const scArgs = [
        nativeToScVal(Address.fromString(adminAddress)),
        nativeToScVal(BigInt(roundId), { type: 'u64' }),
        nativeToScVal(BigInt(projectId), { type: 'u64' }),
      ];

      const result = await this.executeOnChainTransaction(
        'approve_project',
        scArgs,
      );

      this.emitStructuredLog(
        action,
        'SUCCESS',
        args,
        startTime,
        result.txHash,
        null,
      );

      return {
        transactionHash: result.txHash,
        status: 'SUCCESS',
      };
    } catch (error) {
      this.emitStructuredLog(action, 'FAILED', args, startTime, null, error);
      throw new BadRequestException(
        `On-chain approveProject failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async finalizeRound(roundId: number): Promise<{
    transactionHash: string;
    status: string;
  }> {
    const startTime = Date.now();
    const action = 'FINALIZE_ROUND';
    const args = { roundId };

    this.emitStructuredLog(action, 'INITIATED', args);

    if (this.useMock) {
      const record = this.mockRounds.get(roundId);
      if (!record) {
        const err = new NotFoundException(`Round ${roundId} not found`);
        this.emitStructuredLog(action, 'FAILED', args, startTime, null, err);
        throw err;
      }
      if (record.isFinalized) {
        const err = new BadRequestException('Round is already finalized');
        this.emitStructuredLog(action, 'FAILED', args, startTime, null, err);
        throw err;
      }

      record.isFinalized = true;
      record.status = 'FINALIZED';
      const txHash = `mock_tx_${Math.random().toString(36).substring(2, 15)}`;

      this.emitStructuredLog(action, 'SUCCESS', args, startTime, txHash);

      return {
        transactionHash: txHash,
        status: 'SUCCESS',
      };
    }

    // On-Chain Execution
    try {
      const adminAddress = this.getAdminAddressOrThrow();
      const scArgs = [
        nativeToScVal(Address.fromString(adminAddress)),
        nativeToScVal(BigInt(roundId), { type: 'u64' }),
      ];

      const result = await this.executeOnChainTransaction(
        'finalize_round',
        scArgs,
      );

      this.emitStructuredLog(
        action,
        'SUCCESS',
        args,
        startTime,
        result.txHash,
        null,
      );

      return {
        transactionHash: result.txHash,
        status: 'SUCCESS',
      };
    } catch (error) {
      this.emitStructuredLog(action, 'FAILED', args, startTime, null, error);
      throw new BadRequestException(
        `On-chain finalizeRound failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  async getRound(roundId: number): Promise<any> {
    if (this.useMock) {
      const record = this.mockRounds.get(roundId);
      if (!record) {
        throw new NotFoundException(`Round ${roundId} not found`);
      }
      return {
        ...record,
        eligibleProjects: [...record.eligibleProjects],
      };
    }

    // On-Chain Simulation read
    try {
      const server = new rpc.Server(this.sorobanRpcUrl);
      const contract = new Contract(this.contractId);

      const tx = new TransactionBuilder(
        new Account(this.getAdminAddressOrThrow(), '-1'),
        {
          fee: BASE_FEE,
          networkPassphrase: this.networkPassphrase,
        },
      )
        .addOperation(
          contract.call('get_round', nativeToScVal(BigInt(roundId), { type: 'u64' })),
        )
        .setTimeout(30)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) {
        throw new Error(sim.error || 'Simulation failed');
      }

      if (!sim.result) {
        throw new Error('Simulation returned no result');
      }

      const rawData = scValToNative(sim.result.retval);
      return {
        id: roundId,
        name: rawData.name,
        tokenAddress: rawData.token_address,
        startTime: Number(rawData.start_time),
        endTime: Number(rawData.end_time),
        totalPool: rawData.total_pool.toString(),
        isFinalized: rawData.is_finalized,
        isDistributed: rawData.is_distributed,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to fetch round details: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async listRounds(): Promise<any[]> {
    if (this.useMock) {
      return [...this.mockRounds.values()].map((r) => ({
        ...r,
        eligibleProjects: [...r.eligibleProjects],
      }));
    }

    // Since Soroban persistence doesn't easily offer iterating keys, we iterate roundIds up to NextRoundId if possible.
    // For convenience in listing, we return mock/synced database rounds or query round 0-5.
    // Let's implement a safe list starting from round 0 up to round 10 and return what exists.
    const rounds = [];
    for (let id = 0; id < 10; id++) {
      try {
        const round = await this.getRound(id);
        rounds.push(round);
      } catch {
        break; // Stop at first round not found
      }
    }
    return rounds;
  }

  // ── On-chain Transaction Engine ────────────────────────────────────────────

  private getAdminAddressOrThrow(): string {
    if (!this.serverKeypair) {
      throw new BadRequestException(
        'STELLAR_SERVER_SECRET is not configured or invalid',
      );
    }
    return this.serverKeypair.publicKey();
  }

  private async executeOnChainTransaction(
    method: string,
    args: any[],
  ): Promise<{ txHash: string; retval: any }> {
    if (!this.serverKeypair) {
      throw new Error('Server keypair is not configured for signing');
    }

    const server = new rpc.Server(this.sorobanRpcUrl);
    const adminAddress = this.serverKeypair.publicKey();

    // 1. Fetch current sequence
    const sourceAccount = await server.getAccount(adminAddress);

    // 2. Build initial transaction calling the contract
    const contract = new Contract(this.contractId);
    let tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    // 3. Simulate to calculate fee and footprint
    const simulation = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw new Error(`Simulation failed: ${simulation.error}`);
    }

    // 4. Assemble simulation footprint into transaction
    tx = rpc.assembleTransaction(tx, simulation).build();

    // 5. Sign transaction
    tx.sign(this.serverKeypair);

    // 6. Submit transaction
    const submission = await server.sendTransaction(tx);
    if (submission.status === 'ERROR') {
      throw new Error(
        `Submission failed: ${JSON.stringify(submission.errorResultXdr)}`,
      );
    }

    // 7. Poll status
    const txHash = submission.hash;
    const maxAttempts = 15;
    const delayMs = 1500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const statusResponse = await server.getTransaction(txHash);
      if (statusResponse.status === 'SUCCESS') {
        return {
          txHash,
          retval: statusResponse.resultMetaXdr
            ? statusResponse.returnValue
            : null,
        };
      } else if (statusResponse.status === 'FAILED') {
        throw new Error(
          `Transaction execution failed on ledger. Result XDR: ${statusResponse.resultXdr}`,
        );
      }
      // PENDING or NOT_FOUND - wait and retry
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error(`Transaction polling timed out for hash: ${txHash}`);
  }

  // ── Logging & Seed Helpers ─────────────────────────────────────────────────

  private emitStructuredLog(
    action: string,
    status: 'INITIATED' | 'SUCCESS' | 'FAILED',
    args: any,
    startTime?: number,
    txHash?: string | null,
    error?: any,
    extraData?: any,
  ) {
    const duration = startTime ? Date.now() - startTime : null;
    const logObject = {
      timestamp: new Date().toISOString(),
      service: 'MatchingPoolService',
      action,
      status,
      contractId: this.contractId,
      arguments: args,
      isMock: this.useMock,
      ...(duration !== null && { durationMs: duration }),
      ...(txHash && { transactionHash: txHash }),
      ...(error && {
        error: {
          message: error.message || String(error),
          stack: error.stack,
        },
      }),
      ...(extraData && { extra: extraData }),
    };

    if (status === 'FAILED') {
      this.logger.error(`Structured Log [FAILED]: ${JSON.stringify(logObject)}`);
    } else {
      this.logger.log(`Structured Log [${status}]: ${JSON.stringify(logObject)}`);
    }
  }

  private seedMockData() {
    this.mockRounds.set(0, {
      id: 0,
      name: 'Round1',
      tokenAddress: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      startTime: Math.floor((Date.now() - 3600 * 24 * 5 * 1000) / 1000), // started 5 days ago
      endTime: Math.floor((Date.now() + 3600 * 24 * 5 * 1000) / 1000), // ends in 5 days
      totalPool: '1000000000',
      isFinalized: false,
      eligibleProjects: new Set<number>([1, 2]),
      status: 'ACTIVE',
    });
    this.mockRounds.set(1, {
      id: 1,
      name: 'GenesisRound',
      tokenAddress: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      startTime: Math.floor((Date.now() - 3600 * 24 * 30 * 1000) / 1000), // 30 days ago
      endTime: Math.floor((Date.now() - 3600 * 24 * 20 * 1000) / 1000), // ended 20 days ago
      totalPool: '5000000000',
      isFinalized: true,
      eligibleProjects: new Set<number>([1, 3, 4]),
      status: 'FINALIZED',
    });
    this.mockNextRoundId = 2;
  }
}
