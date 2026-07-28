import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AllocateBudgetDto } from './dto/allocate-budget.dto';
import {
  AllocateBudgetResponseDto,
  StreamStateDto,
} from './dto/stream-response.dto';
import {
  StreamPreviewDto,
  StreamPreviewResponseDto,
} from './dto/stream-preview.dto';
import { RotateBeneficiaryDto } from './dto/rotate-beneficiary.dto';
import {
  QueryBeneficiaryHistoryDto,
  BeneficiaryHistoryResponseDto,
  BeneficiaryHistoryItemDto,
} from './dto/beneficiary-history.dto';
import { TreasuryBeneficiaryHistory } from './entities/treasury-beneficiary-history.entity';
import { AdminBlockchainAuditLog } from '../admin-audit/entities/admin-blockchain-audit-log.entity';
import { TreasuryStreamNotFoundException } from './exceptions/treasury.exceptions';
import { TreasurySorobanClient } from './treasury-soroban.client';
import { calculateUnlocked, RawStreamData } from './treasury-stream.util';

@Injectable()
export class TreasuryService {
  private readonly logger = new Logger(TreasuryService.name);

  constructor(
    private readonly sorobanClient: TreasurySorobanClient,
    @Optional()
    @InjectRepository(TreasuryBeneficiaryHistory)
    private readonly beneficiaryHistoryRepo?: Repository<TreasuryBeneficiaryHistory>,
    @Optional()
    @InjectRepository(AdminBlockchainAuditLog)
    private readonly auditLogRepo?: Repository<AdminBlockchainAuditLog>,
  ) {}

  /**
   * Admin flow: allocate a budget and start a vesting stream for a beneficiary
   * against the on-chain treasury contract.
   */
  async allocateBudget(
    dto: AllocateBudgetDto,
    actorContext?: { actorId?: string; actorEmail?: string },
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

    await this.recordBeneficiaryHistory({
      beneficiary: dto.beneficiary,
      action: 'ALLOCATED',
      amount: dto.amount,
      txHash: submitted.hash,
      actorId: actorContext?.actorId || null,
      actorEmail: actorContext?.actorEmail || null,
      metadata: {
        startTime: dto.startTime,
        duration: dto.duration,
        ledger: submitted.ledger,
      },
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
  async previewStream(
    dto: StreamPreviewDto,
  ): Promise<StreamPreviewResponseDto> {
    const { beneficiary, atTime } = dto;
    const previewAt = atTime ?? Math.floor(Date.now() / 1000);

    this.logger.log(`Previewing stream for ${beneficiary} at t=${previewAt}`);

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
    actorContext?: { actorId?: string; actorEmail?: string },
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

    await this.recordBeneficiaryHistory({
      beneficiary: dto.newBeneficiary,
      previousBeneficiary: dto.oldBeneficiary,
      action: 'ROTATED',
      amount: stream.totalAmount.toString(),
      txHash: submitted.hash,
      actorId: actorContext?.actorId || null,
      actorEmail: actorContext?.actorEmail || null,
      metadata: { ledger: submitted.ledger },
    });

    return {
      transactionHash: submitted.hash,
      status: submitted.status,
      ledger: submitted.ledger,
      stream: this.toStreamStateDto(stream),
    };
  }

  /**
   * Record a beneficiary history event safely.
   */
  async recordBeneficiaryHistory(
    data: Partial<TreasuryBeneficiaryHistory>,
  ): Promise<TreasuryBeneficiaryHistory | null> {
    if (!this.beneficiaryHistoryRepo) {
      return null;
    }
    try {
      const entry = this.beneficiaryHistoryRepo.create(data);
      return await this.beneficiaryHistoryRepo.save(entry);
    } catch (err) {
      this.logger.error('Failed to record treasury beneficiary history', err);
      return null;
    }
  }

  /**
   * Query audit-safe beneficiary change history for streams or accounts.
   * Handles cases with no history gracefully.
   */
  async getBeneficiaryHistory(
    dto: QueryBeneficiaryHistoryDto,
  ): Promise<BeneficiaryHistoryResponseDto> {
    const page = Math.max(1, dto.page ?? 1);
    const limit = Math.min(100, Math.max(1, dto.limit ?? 20));
    const targetBeneficiary = dto.beneficiary || dto.account;

    let items: BeneficiaryHistoryItemDto[] = [];
    let total = 0;

    if (this.beneficiaryHistoryRepo) {
      if (targetBeneficiary) {
        const [records, count] = await this.beneficiaryHistoryRepo.findAndCount(
          {
            where: [
              { beneficiary: targetBeneficiary },
              { previousBeneficiary: targetBeneficiary },
            ],
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
          },
        );
        total = count;
        items = records.map((r) => ({
          id: r.id,
          beneficiary: r.beneficiary,
          previousBeneficiary: r.previousBeneficiary,
          action: r.action,
          amount: r.amount,
          txHash: r.txHash,
          actorId: r.actorId,
          actorEmail: r.actorEmail,
          createdAt: r.createdAt,
          metadata: r.metadata,
        }));
      } else {
        const [records, count] = await this.beneficiaryHistoryRepo.findAndCount(
          {
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
          },
        );
        total = count;
        items = records.map((r) => ({
          id: r.id,
          beneficiary: r.beneficiary,
          previousBeneficiary: r.previousBeneficiary,
          action: r.action,
          amount: r.amount,
          txHash: r.txHash,
          actorId: r.actorId,
          actorEmail: r.actorEmail,
          createdAt: r.createdAt,
          metadata: r.metadata,
        }));
      }
    }

    // Fallback/enrichment from audit logs if DB beneficiary history table returned no records
    if (items.length === 0 && targetBeneficiary && this.auditLogRepo) {
      try {
        const auditLogs = await this.auditLogRepo.find({
          where: { targetContract: 'treasury' },
          order: { createdAt: 'DESC' },
          take: 100,
        });

        const matchedLogs = auditLogs.filter((log) => {
          const summary = log.paramsSummary ?? {};
          return (
            summary.beneficiary === targetBeneficiary ||
            summary.oldBeneficiary === targetBeneficiary ||
            summary.newBeneficiary === targetBeneficiary
          );
        });

        total = matchedLogs.length;
        const pageLogs = matchedLogs.slice((page - 1) * limit, page * limit);
        items = pageLogs.map((log) => {
          const summary = log.paramsSummary ?? {};
          const isRotate = log.endpoint.includes('rotate');
          return {
            id: log.id,
            beneficiary: isRotate
              ? (summary.newBeneficiary as string) || targetBeneficiary
              : (summary.beneficiary as string) || targetBeneficiary,
            previousBeneficiary: isRotate
              ? (summary.oldBeneficiary as string) || null
              : null,
            action: isRotate ? 'ROTATED' : 'ALLOCATED',
            amount: (summary.amount as string) || null,
            txHash: log.txHash,
            actorId: log.actorId,
            actorEmail: log.actorEmail,
            createdAt: log.createdAt,
            metadata: {
              endpoint: log.endpoint,
              responseStatus: log.responseStatus,
            },
          };
        });
      } catch (err) {
        this.logger.error(
          'Failed to query audit logs for beneficiary history fallback',
          err,
        );
      }
    }

    return {
      beneficiary: targetBeneficiary,
      history: items,
      total,
      page,
      limit,
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
