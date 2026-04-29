import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from './entities/user.entity';
import { StellarAccount } from './entities/stellar-account.entity';
import { StellarService } from '../stellar/stellar.service';
import { LinkStellarAccountDto } from './dto/link-stellar-account.dto';
import { StellarAccountResponseDto } from './dto/stellar-account-response.dto';
import { UpdateStellarAccountLabelDto } from './dto/update-stellar-account-label.dto';
import { UploadService } from '../upload/upload.service';
import crypto from 'crypto';
import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Account,
  Transaction,
} from '@stellar/stellar-sdk';

interface WalletChallengeData {
  nonce: string;
  timestamp: number;
  challengeXDR: string;
  expiresAt: number;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly challengeStore = new Map<string, WalletChallengeData>();
  private readonly CHALLENGE_TIMEOUT = 5 * 60 * 1000;
  private readonly serverKeypair: Keypair;
  private readonly stellarNetwork: string;

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(StellarAccount)
    private stellarAccountRepository: Repository<StellarAccount>,
    private stellarService: StellarService,
    private uploadService: UploadService,
    private configService: ConfigService,
  ) {
    const serverSecret = this.configService.get<string>(
      'STELLAR_SERVER_SECRET',
    );
    if (!serverSecret) {
      throw new Error('STELLAR_SERVER_SECRET is not configured');
    }
    this.serverKeypair = Keypair.fromSecret(serverSecret);

    this.stellarNetwork = this.configService.get<string>(
      'STELLAR_NETWORK',
      'testnet',
    );

    setInterval(() => this.cleanupExpiredChallenges(), 60000).unref();
  }

  // --- BASIC CRUD ---

  async create(user: Partial<User>): Promise<User> {
    const newUser = this.usersRepository.create(user);
    return this.usersRepository.save(newUser);
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ email });
  }

  /**
   * Updates user profile data (Merged from Upstream)
   */
  async update(id: string, updateData: Partial<User>): Promise<User> {
    await this.usersRepository.update(id, updateData);
    const updatedUser = await this.usersRepository.findOneBy({ id });
    if (!updatedUser) {
      throw new NotFoundException(`User with id ${id} not found`);
    }
    return updatedUser;
  }

  async updateUserProfilePicture(file: Buffer, id: string) {
    const fileName = `${crypto.randomUUID()}.webp`;
    const url = await this.uploadService.uploadFile(file, fileName);
    const updateResult = await this.usersRepository.update(id, {
      avatarUrl: url,
    });
    if (updateResult.affected === 0) {
      throw new NotFoundException('User not found');
    }
    return url;
  }

  // --- STELLAR ACCOUNT MANAGEMENT ---

  async addStellarAccount(
    userId: string,
    dto: LinkStellarAccountDto,
  ): Promise<StellarAccountResponseDto> {
    this.stellarService.validatePublicKeyOrThrow(dto.publicKey);

    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const existingAccount = await this.stellarAccountRepository.findOne({
      where: { publicKey: dto.publicKey },
    });

    if (existingAccount) {
      throw new ConflictException(
        'This Stellar account is already linked to another user',
      );
    }

    const accountCount = await this.stellarAccountRepository.count({
      where: { userId },
    });

    if (accountCount >= 10) {
      throw new BadRequestException(
        'Maximum number of Stellar accounts (10) reached',
      );
    }

    try {
      const accountExists = await this.stellarService.accountExists(
        dto.publicKey,
      );
      if (!accountExists) {
        this.logger.warn(
          `Adding Stellar account that doesn't exist on network yet: ${dto.publicKey}`,
        );
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug(
        `Could not verify account existence for ${dto.publicKey}: ${errorMessage}`,
      );
    }

    const stellarAccount = this.stellarAccountRepository.create({
      userId,
      publicKey: dto.publicKey,
      label: dto.label || undefined,
      isActive: true,
    });

    const savedAccount =
      await this.stellarAccountRepository.save(stellarAccount);

    // Set first account as primary automatically if none exists
    if (!user.stellarPublicKey) {
      user.stellarPublicKey = dto.publicKey;
      await this.usersRepository.save(user);
    }

    return this.mapToResponseDto(savedAccount);
  }

  async getStellarAccounts(
    userId: string,
  ): Promise<StellarAccountResponseDto[]> {
    const accounts = await this.stellarAccountRepository.find({
      where: { userId, isActive: true },
      order: { createdAt: 'DESC' },
    });

    return accounts.map((account) => this.mapToResponseDto(account));
  }

  async getStellarAccount(
    userId: string,
    accountId: string,
  ): Promise<StellarAccountResponseDto> {
    const account = await this.stellarAccountRepository.findOne({
      where: { id: accountId, userId },
    });

    if (!account) {
      throw new NotFoundException('Stellar account not found');
    }

    return this.mapToResponseDto(account);
  }

  async removeStellarAccount(userId: string, accountId: string): Promise<void> {
    const account = await this.stellarAccountRepository.findOne({
      where: { id: accountId, userId },
    });

    if (!account) {
      throw new NotFoundException('Stellar account not found');
    }

    account.isActive = false;
    await this.stellarAccountRepository.save(account);
  }

  async updateStellarAccountLabel(
    userId: string,
    accountId: string,
    dto: UpdateStellarAccountLabelDto,
  ): Promise<StellarAccountResponseDto> {
    const account = await this.stellarAccountRepository.findOne({
      where: { id: accountId, userId },
    });

    if (!account) {
      throw new NotFoundException('Stellar account not found');
    }

    account.label = dto.label;
    const updatedAccount = await this.stellarAccountRepository.save(account);

    return this.mapToResponseDto(updatedAccount);
  }

  async setPrimaryAccount(userId: string, accountId: string): Promise<void> {
    const account = await this.stellarAccountRepository.findOne({
      where: { id: accountId, userId },
    });

    if (!account) {
      throw new NotFoundException('Stellar account not found');
    }

    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.stellarPublicKey = account.publicKey;
    await this.usersRepository.save(user);
  }

  generateWalletChallenge(publicKey: string): {
    challenge: string;
    nonce: string;
    expiresIn: number;
    publicKey: string;
  } {
    this.stellarService.validatePublicKeyOrThrow(publicKey);

    const nonce = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now();

    const sourceAccount = new Account(this.serverKeypair.publicKey(), '-1');

    const networkPassphrase =
      this.stellarNetwork === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;

    const transaction = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase,
      timebounds: {
        minTime: 0,
        maxTime: Math.floor(timestamp / 1000) + 300,
      },
    })
      .addOperation(
        Operation.manageData({
          name: 'LumenPulse verify',
          value: Buffer.from(nonce),
          source: publicKey,
        }),
      )
      .addOperation(
        Operation.manageData({
          name: 'web_auth_domain',
          value: Buffer.from(
            this.configService.get<string>('DOMAIN', 'lumenpulse.io'),
          ),
          source: this.serverKeypair.publicKey(),
        }),
      )
      .build();

    transaction.sign(this.serverKeypair);

    const challengeXDR = transaction.toXDR();

    this.challengeStore.set(publicKey, {
      nonce,
      timestamp,
      challengeXDR,
      expiresAt: timestamp + this.CHALLENGE_TIMEOUT,
    });

    this.logger.debug(`Wallet challenge generated for ${publicKey}`);

    return {
      challenge: challengeXDR,
      nonce,
      expiresIn: 300,
      publicKey,
    };
  }

  verifyWalletChallenge(
    publicKey: string,
    signedChallenge: string,
  ): { verified: boolean; publicKey: string; message: string } {
    this.stellarService.validatePublicKeyOrThrow(publicKey);

    const storedChallenge = this.challengeStore.get(publicKey);

    if (!storedChallenge) {
      throw new BadRequestException(
        'No challenge found for this public key. Please request a new challenge.',
      );
    }

    if (Date.now() > storedChallenge.expiresAt) {
      this.challengeStore.delete(publicKey);
      throw new BadRequestException(
        'Challenge has expired. Please request a new challenge.',
      );
    }

    const networkPassphrase =
      this.stellarNetwork === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;

    let transaction: Transaction;

    try {
      transaction = new Transaction(signedChallenge, networkPassphrase);
    } catch {
      this.challengeStore.delete(publicKey);
      throw new BadRequestException('Invalid transaction format');
    }

    const userSignature = transaction.signatures.find((sig) => {
      try {
        const keypair = Keypair.fromPublicKey(publicKey);
        return keypair.verify(transaction.hash(), sig.signature());
      } catch {
        return false;
      }
    });

    if (!userSignature) {
      this.challengeStore.delete(publicKey);
      throw new BadRequestException(
        'Invalid signature. Transaction was not signed by the provided public key.',
      );
    }

    this.challengeStore.delete(publicKey);

    this.logger.debug(`Wallet challenge verified for ${publicKey}`);

    return {
      verified: true,
      publicKey,
      message: 'Wallet ownership verified successfully',
    };
  }

  async markAccountVerified(publicKey: string): Promise<void> {
    const account = await this.stellarAccountRepository.findOne({
      where: { publicKey },
    });

    if (!account) {
      throw new NotFoundException('Stellar account not found');
    }

    account.isVerified = true;
    await this.stellarAccountRepository.save(account);
  }

  private cleanupExpiredChallenges(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, value] of this.challengeStore.entries()) {
      if (now > value.expiresAt) {
        this.challengeStore.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} expired wallet challenges`);
    }
  }

  private mapToResponseDto(account: StellarAccount): StellarAccountResponseDto {
    return {
      id: account.id,
      publicKey: account.publicKey,
      label: account.label,
      isPrimary: account.isPrimary,
      isActive: account.isActive,
      isVerified: account.isVerified,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }
}
