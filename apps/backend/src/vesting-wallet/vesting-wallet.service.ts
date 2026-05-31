import { Injectable, Logger } from '@nestjs/common';
import {
  CreateVestingDto,
  CreateVestingWithMilestoneDto,
} from './dto/create-vesting.dto';
import {
  CreateVestingResponseDto,
  VestingDataDto,
} from './dto/vesting-response.dto';
import { VestingWalletSorobanClient } from './vesting-wallet-soroban.client';
import { calculateClaimable, RawVestingData } from './vesting-stream.util';
import { VestingWalletNotFoundException } from './exceptions/vesting-wallet.exceptions';

@Injectable()
export class VestingWalletService {
  private readonly logger = new Logger(VestingWalletService.name);

  constructor(private readonly sorobanClient: VestingWalletSorobanClient) {}

  async createVesting(
    dto: CreateVestingDto,
  ): Promise<CreateVestingResponseDto> {
    this.logger.log(
      `Creating vesting schedule for ${dto.beneficiary} ` +
        `(amount=${dto.amount}, start=${dto.startTime}, duration=${dto.duration})`,
    );

    const submitted = await this.sorobanClient.createVesting({
      beneficiary: dto.beneficiary,
      amount: dto.amount,
      startTime: dto.startTime,
      duration: dto.duration,
    });

    const vesting: RawVestingData = {
      beneficiary: dto.beneficiary,
      totalAmount: BigInt(dto.amount),
      claimedAmount: 0n,
      startTime: BigInt(dto.startTime),
      duration: BigInt(dto.duration),
    };

    return {
      transactionHash: submitted.hash,
      status: submitted.status,
      ledger: submitted.ledger,
      vesting: this.toVestingDataDto(vesting),
    };
  }

  async createVestingWithMilestone(
    dto: CreateVestingWithMilestoneDto,
  ): Promise<CreateVestingResponseDto> {
    this.logger.log(
      `Creating milestone-gated vesting for ${dto.beneficiary} ` +
        `(amount=${dto.amount}, start=${dto.startTime}, duration=${dto.duration}, ` +
        `vault=${dto.vaultContract}, project=${dto.projectId}, milestone=${dto.milestoneId})`,
    );

    const submitted = await this.sorobanClient.createVestingWithMilestone({
      beneficiary: dto.beneficiary,
      amount: dto.amount,
      startTime: dto.startTime,
      duration: dto.duration,
      vaultContract: dto.vaultContract,
      projectId: dto.projectId,
      milestoneId: dto.milestoneId,
    });

    const vesting: RawVestingData = {
      beneficiary: dto.beneficiary,
      totalAmount: BigInt(dto.amount),
      claimedAmount: 0n,
      startTime: BigInt(dto.startTime),
      duration: BigInt(dto.duration),
    };

    return {
      transactionHash: submitted.hash,
      status: submitted.status,
      ledger: submitted.ledger,
      vesting: this.toVestingDataDto(
        vesting,
        true,
        dto.vaultContract,
        dto.projectId,
        dto.milestoneId,
      ),
    };
  }

  async getVesting(beneficiary: string): Promise<VestingDataDto> {
    const raw = await this.sorobanClient.getVesting(beneficiary);
    if (!raw) {
      throw new VestingWalletNotFoundException(beneficiary);
    }
    return this.toVestingDataDto(raw);
  }

  async getClaimable(
    beneficiary: string,
  ): Promise<Record<string, string | number>> {
    const raw = await this.sorobanClient.getVesting(beneficiary);
    if (!raw) {
      throw new VestingWalletNotFoundException(beneficiary);
    }

    const now = BigInt(Math.floor(Date.now() / 1000));
    const claimable = calculateClaimable(now, raw);
    const remaining = raw.totalAmount - raw.claimedAmount;

    return {
      beneficiary: raw.beneficiary,
      totalAmount: raw.totalAmount.toString(),
      claimedAmount: raw.claimedAmount.toString(),
      claimableAmount: (claimable < 0n ? 0n : claimable).toString(),
      remainingAmount: (remaining < 0n ? 0n : remaining).toString(),
      startTime: Number(raw.startTime),
      duration: Number(raw.duration),
    };
  }

  private toVestingDataDto(
    vesting: RawVestingData,
    hasMilestoneRequirement: boolean = false,
    vaultContract: string | null = null,
    projectId: number | null = null,
    milestoneId: number | null = null,
  ): VestingDataDto {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const claimable = calculateClaimable(now, vesting);
    const remaining = vesting.totalAmount - vesting.claimedAmount;

    return {
      beneficiary: vesting.beneficiary,
      totalAmount: vesting.totalAmount.toString(),
      claimedAmount: vesting.claimedAmount.toString(),
      claimableAmount: (claimable < 0n ? 0n : claimable).toString(),
      remainingAmount: (remaining < 0n ? 0n : remaining).toString(),
      startTime: Number(vesting.startTime),
      duration: Number(vesting.duration),
      hasMilestoneRequirement,
      vaultContract,
      projectId,
      milestoneId,
    };
  }
}
