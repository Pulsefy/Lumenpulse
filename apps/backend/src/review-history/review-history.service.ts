import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateReviewHistoryDto, ReviewHistoryItemDto } from './dto/review-history.dto';
import { ReviewDecision, ReviewHistory } from './entities/review-history.entity';

@Injectable()
export class ReviewHistoryService {
  constructor(
    @InjectRepository(ReviewHistory)
    private readonly reviewHistoryRepository: Repository<ReviewHistory>,
  ) {}

  async create(
    actorId: string,
    dto: CreateReviewHistoryDto,
    submissionId: number | null = null,
  ): Promise<ReviewHistoryItemDto> {
    const inferredSubmissionId =
      submissionId ??
      (dto.targetType === 'project-submission' && /^\d+$/.test(dto.targetId)
        ? Number(dto.targetId)
        : null);
    const record = this.reviewHistoryRepository.create({
      actorId,
      submissionId: inferredSubmissionId,
      targetType: dto.targetType,
      targetId: dto.targetId,
      decision: dto.decision,
      comment: dto.comment ?? null,
      isInternal: dto.isInternal ?? false,
      metadata: dto.metadata ?? {},
    });
    return this.toDto(await this.reviewHistoryRepository.save(record), true);
  }

  async recordSubmissionDecision(
    submissionId: number,
    actorId: string,
    decision: ReviewDecision,
    comment?: string,
  ): Promise<void> {
    await this.create(
      actorId,
      {
        targetType: 'project-submission',
        targetId: String(submissionId),
        decision,
        comment,
        metadata: { submissionId },
      },
      submissionId,
    );
  }

  async findBySubmission(
    submissionId: number,
    includeInternal = false,
  ): Promise<ReviewHistoryItemDto[]> {
    const records = await this.reviewHistoryRepository.find({
      where: { submissionId },
      order: { createdAt: 'ASC' },
    });
    return records.map((record) => this.toDto(record, includeInternal));
  }

  async findByTarget(
    targetType: string,
    targetId: string,
    includeInternal = false,
  ): Promise<ReviewHistoryItemDto[]> {
    const records = await this.reviewHistoryRepository.find({
      where: { targetType, targetId },
      order: { createdAt: 'ASC' },
    });
    return records.map((record) => this.toDto(record, includeInternal));
  }

  private toDto(record: ReviewHistory, includeInternal: boolean): ReviewHistoryItemDto {
    return {
      id: record.id,
      submissionId: record.submissionId,
      targetType: record.targetType,
      targetId: record.targetId,
      decision: record.decision,
      comment: includeInternal || !record.isInternal ? record.comment : undefined,
      actorId: record.actorId,
      metadata: includeInternal || !record.isInternal ? record.metadata : {},
      createdAt: record.createdAt,
    };
  }
}
