import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  Keypair,
  Account,
  TransactionBuilder,
  BASE_FEE,
  Contract,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import {
  SorobanRpcClientService,
  SorobanRpcError,
} from './soroban-rpc-client.service';
import { config } from '../../lib/config';
import {
  CreateRoundDto,
  ApproveProjectDto,
  RoundResponseDto,
} from '../dto/matching-pool.dto';

const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

@Injectable()
export class MatchingPoolAdminService {
  private readonly logger = new Logger(MatchingPoolAdminService.name);

  constructor(private readonly sorobanRpc: SorobanRpcClientService) {}

  async createRound(
    dto: CreateRoundDto,
    adminUserId: string,
  ): Promise<RoundResponseDto> {
    const contractId = config.stellar.contracts.matchingPool;
    if (!contractId) {
      throw new BadRequestException('Matching pool contract not configured');
    }

    this.logger.log(
      { adminUserId, roundName: dto.name, matchingFunds: dto.matchingFunds },
      'Admin creating matching round',
    );

    try {
      const keypair = Keypair.fromSecret(config.stellar.serverSecret.reveal());
      const account = await this.sorobanRpc.getAccount(keypair.publicKey());

      const tx = new TransactionBuilder(
        new Account(account.accountId(), account.sequenceNumber()),
        { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE },
      )
        .addOperation(
          new Contract(contractId).call(
            'create_round',
            nativeToScVal(dto.name, { type: 'string' }),
            nativeToScVal(dto.matchingFunds, { type: 'i128' }),
          ),
        )
        .setTimeout(30)
        .build();

      const simulation = await this.sorobanRpc.simulateTransaction(tx);

      // Assemble and sign
      const { rpc: rpcSdk } = await import('@stellar/stellar-sdk');
      const assembled = rpcSdk.assembleTransaction(tx, simulation).build();
      assembled.sign(keypair);

      const result = await this.sorobanRpc.sendTransaction(assembled);

      this.logger.log(
        { adminUserId, txHash: result.hash, roundName: dto.name },
        'Matching round created on-chain',
      );

      return {
        roundId: result.hash, // use txHash as idempotency key until contract emits ID
        txHash: result.hash,
        status: result.status,
        createdAt: new Date(),
      };
    } catch (err) {
      this.handleError(err, 'createRound');
    }
  }

  async approveProject(
    roundId: string,
    dto: ApproveProjectDto,
    adminUserId: string,
  ): Promise<RoundResponseDto> {
    const contractId = config.stellar.contracts.matchingPool;
    if (!contractId) {
      throw new BadRequestException('Matching pool contract not configured');
    }

    this.logger.log(
      { adminUserId, roundId, projectAddress: dto.projectAddress },
      'Admin approving project for matching round',
    );

    try {
      const keypair = Keypair.fromSecret(config.stellar.serverSecret.reveal());
      const account = await this.sorobanRpc.getAccount(keypair.publicKey());

      const tx = new TransactionBuilder(
        new Account(account.accountId(), account.sequenceNumber()),
        { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE },
      )
        .addOperation(
          new Contract(contractId).call(
            'approve_project',
            nativeToScVal(roundId, { type: 'string' }),
            xdr.ScVal.scvAddress(
              xdr.ScAddress.scAddressTypeAccount(
                xdr.PublicKey.publicKeyTypeEd25519(
                  Keypair.fromPublicKey(dto.projectAddress).rawPublicKey(),
                ),
              ),
            ),
          ),
        )
        .setTimeout(30)
        .build();

      const simulation = await this.sorobanRpc.simulateTransaction(tx);

      const { rpc: rpcSdk } = await import('@stellar/stellar-sdk');
      const assembled = rpcSdk.assembleTransaction(tx, simulation).build();
      assembled.sign(keypair);

      const result = await this.sorobanRpc.sendTransaction(assembled);

      this.logger.log(
        {
          adminUserId,
          txHash: result.hash,
          roundId,
          project: dto.projectAddress,
        },
        'Project approved on-chain',
      );

      return {
        roundId,
        txHash: result.hash,
        status: result.status,
        createdAt: new Date(),
      };
    } catch (err) {
      this.handleError(err, 'approveProject');
    }
  }

  private handleError(err: unknown, method: string): never {
    if (err instanceof SorobanRpcError) {
      this.logger.error(
        { method, code: err.code, message: err.message },
        'Soroban RPC error',
      );
      throw new BadRequestException(`On-chain call failed: ${err.message}`);
    }
    if (err instanceof BadRequestException) throw err;

    this.logger.error({ method, err }, 'Unexpected matching pool error');
    throw new InternalServerErrorException('Matching pool operation failed');
  }
}
