import { Injectable, Logger } from '@nestjs/common';
import { AllocateBudgetDto } from './dto/allocate-budget.dto';
import {
  AllocateBudgetResponseDto,
  StreamStateDto,
} from './dto/stream-response.dto';
import { StreamPreviewDto, StreamPreviewResponseDto } from './dto/stream-preview.dto';
import { RotateBeneficiaryDto } from './dto/rotate-beneficiary.dto';
import { TreasuryStreamNotFoundException } from './exceptions/treasury.exceptions';
import { TreasurySorobanClient } from './treasury-soroban.client';
import { calculateUnlocked, RawStreamData } from './treasury-stream.util';

@Injectable()
export class TreasuryService {
  private readonly logger = new Logger(TreasuryService.name);

  constructor(private readonly sorobanClient: TreasurySorobanClient) {}

  /**
   * Admin flow: allocate a budget and start a vesting stream for a beneficiary
   * against the on-chain treasury contract.
   */
  async allocateBudget(
    dto: AllocateBudgetDto,
  ): Promise<AllocateBudgetResponseDto> {
    this.logger.log(
      `Allocating budget of ${dto.amount} to ${dto.beneficiary} ` +
        `(start=${dto.startTime}, duration=${dto.duration})`,
    );

    const submitted = await this.sorobanClient.allocateBudget({
      beneficiary: dto.beneficiary,
      amount: dto.amount,
      startTime: dto.startTime,
      duration: dto.duration,
    });

    // A freshly allocated stream has nothing claimed yet; reflect the request
    // state rather than re-reading (which can lag block propagation).
    const stream: RawStreamData = {
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
      stream: this.toStreamStateDto(stream),
    };
  }

  /**
   * Read flow: return the current stream state for a beneficiary, including the
   * amount currently unlocked.
   */
  async getStream(beneficiary: string): Promise<StreamStateDto> {
    const stream = await this.sorobanClient.getStream(beneficiary);
    if (!stream) {
      throw new TreasuryStreamNotFoundException(beneficiary);
    }
    return this.toStreamStateDto(stream);
  }

  /**
   * Read-only preview: compute unlocked, claimed, and remaining amounts for a
   * beneficiary at a given time without submitting any transaction.
   *
   * Uses the same linear-vesting formula as the on-chain contract so the result
   * matches what a claim call would see at `atTime`.
   *
   * @throws TreasuryStreamNotFoundException when no stream exists for the beneficiary.
   */
  async previewStream(dto: StreamPreviewDto): Promise<StreamPreviewResponseDto> {
    const { beneficiary, atTime } = dto;
    const previewAt = atTime ?? Math.floor(Date.now() / 1000);

    this.logger.log(
      `Previewing stream for ${beneficiary} at t=${previewAt}`,
    );

    const stream = await this.sorobanClient.getStream(beneficiary);
    if (!stream) {
      throw new TreasuryStreamNotFoundException(beneficiary);
    }

    const now = BigInt(previewAt);
    const unlockedAmount = calculateUnlocked(now, stream);
    const remainingAmount = stream.totalAmount - stream.claimedAmount;

    const streamStart = Number(stream.startTime);
    const streamEnd = streamStart + Number(stream.duration);
    const isActive = previewAt >= streamStart && previewAt < streamEnd;

    return {
      beneficiary: stream.beneficiary,
      totalAmount: stream.totalAmount.toString(),
      claimedAmount: stream.claimedAmount.toString(),
      unlockedAmount: unlockedAmount.toString(),
      remainingAmount: remainingAmount.toString(),
      startTime: streamStart,
      duration: Number(stream.duration),
      previewAt,
      isActive,
    };
  }

  /**
   * Admin flow: rotate beneficiary for a treasury stream, preserving accrued
   * claim state.
   */
  async rotateBeneficiary(
    dto: RotateBeneficiaryDto,
  ): Promise<AllocateBudgetResponseDto> {
    this.logger.log(
      `Rotating beneficiary from ${dto.oldBeneficiary} to ${dto.newBeneficiary}`,
    );

    const submitted = await this.sorobanClient.rotateBeneficiary({
      oldBeneficiary: dto.oldBeneficiary,
      newBeneficiary: dto.newBeneficiary,
    });

    // Read the new stream state for the new beneficiary
    const stream = await this.sorobanClient.getStream(dto.newBeneficiary);
    if (!stream) {
      throw new TreasuryStreamNotFoundException(dto.newBeneficiary);
    }

    return {
      transactionHash: submitted.hash,
      status: submitted.status,
      ledger: submitted.ledger,
      stream: this.toStreamStateDto(stream),
    };
  }

  /** Maps raw on-chain stream data into the API DTO, computing derived amounts. */
  private toStreamStateDto(stream: RawStreamData): StreamStateDto {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const unlocked = calculateUnlocked(now, stream);
    const remaining = stream.totalAmount - stream.claimedAmount;

    return {
      beneficiary: stream.beneficiary,
      totalAmount: stream.totalAmount.toString(),
      claimedAmount: stream.claimedAmount.toString(),
      unlockedAmount: (unlocked < 0n ? 0n : unlocked).toString(),
      remainingAmount: (remaining < 0n ? 0n : remaining).toString(),
      startTime: Number(stream.startTime),
      duration: Number(stream.duration),
    };
  }
}
