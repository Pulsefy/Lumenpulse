import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { StellarAccount } from './entities/stellar-account.entity';
import { StellarService } from '../stellar/stellar.service';
import { LinkStellarAccountDto } from './dto/link-stellar-account.dto';
import { StellarAccountResponseDto } from './dto/stellar-account-response.dto';
import { UpdateStellarAccountLabelDto } from './dto/update-stellar-account-label.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(StellarAccount)
    private stellarAccountRepository: Repository<StellarAccount>,
    private stellarService: StellarService,
  ) {}

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

  private mapToResponseDto(account: StellarAccount): StellarAccountResponseDto {
    return {
      id: account.id,
      publicKey: account.publicKey,
      label: account.label,
      isActive: account.isActive,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }
}
