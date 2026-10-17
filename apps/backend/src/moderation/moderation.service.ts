import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentReport, ReportStatus } from './entities/content-report.entity';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { QueryReportsDto } from './dto/query-reports.dto';
import { ModerationEventPublisherService } from './services/moderation-event-publisher.service';

import { AuditService } from '../audit/audit.service';

export interface ModerationDecisionHistoryEntry {
  id: string;
  reportId: string;
  decision: 'approve' | 'reject' | 'escalate';
  rationale: string;
  decidedById: string;
  decidedByName: string;
  decidedAt: Date;
}

export interface ModerationQueueItem {
  id: string;
  targetType: string;
  targetId: string;
  content: string | null;
  reporterId: string;
  reporterName: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  ageInSeconds: number;
  createdAt: Date;
}

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    @InjectRepository(ContentReport)
    private reportsRepository: Repository<ContentReport>,
    private readonly eventPublisher: ModerationEventPublisherService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Create a new content report
   */
  async createReport(
    reporterId: string,
    dto: CreateReportDto,
  ): Promise<ContentReport> {
    // Check if user already reported this exact target
    const existingReport = await this.reportsRepository
      .createQueryBuilder('report')
      .where('report.reporterId = :reporterId', { reporterId })
      .andWhere('report.targetId = :targetId', { targetId: dto.targetId })
      .andWhere('report.targetType = :targetType', {
        targetType: dto.targetType,
      })
      .andWhere('report.status IN (...statuses)', {
        statuses: [ReportStatus.PENDING, ReportStatus.UNDER_REVIEW],
      })
      .getOne();

    if (existingReport) {
      throw new BadRequestException(
        'You have already reported this content. It is currently under review.',
      );
    }

    const report = this.reportsRepository.create({
      ...dto,
      reporterId,
      status: ReportStatus.PENDING,
    });

    const savedReport = await this.reportsRepository.save(report);
    this.logger.log(
      `New report created: ${savedReport.id} for ${dto.targetType} ${dto.targetId}`,
    );

    // Emit event after successful database write
    await this.eventPublisher.publishModerationEvent(
      'moderation.pending',
      savedReport,
      null, // No previous status for new reports
    );

    return savedReport;
  }

  /**
   * Get a single report by ID
   */
  async getReportById(id: string): Promise<ContentReport> {
    const report = await this.reportsRepository.findOne({
      where: { id },
      relations: ['reporter', 'reviewer'],
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    return report;
  }

  /**
   * Get all reports with pagination and filtering (admin only)
   */
  async getReports(query: QueryReportsDto): Promise<{
    reports: ContentReport[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));

    const queryBuilder = this.reportsRepository
      .createQueryBuilder('report')
      .leftJoinAndSelect('report.reporter', 'reporter')
      .leftJoinAndSelect('report.reviewer', 'reviewer')
      .orderBy('report.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    // Apply filters
    if (query.status) {
      queryBuilder.andWhere('report.status = :status', {
        status: query.status,
      });
    }

    if (query.targetType) {
      queryBuilder.andWhere('report.targetType = :targetType', {
        targetType: query.targetType,
      });
    }

    if (query.targetId) {
      queryBuilder.andWhere('report.targetId = :targetId', {
        targetId: query.targetId,
      });
    }

    if (query.reviewerId !== undefined) {
      if (query.reviewerId === 'unassigned') {
        queryBuilder.andWhere('report.reviewerId IS NULL');
      } else {
        queryBuilder.andWhere('report.reviewerId = :reviewerId', {
          reviewerId: query.reviewerId,
        });
      }
    }

    const [reports, total] = await queryBuilder.getManyAndCount();

    return {
      reports,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get the moderation queue of pending reports with content, reporter, reason and age
   */
  async getModerationQueue(query: QueryReportsTo): Promise<{
    items: ModerationQueueItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));

    const queryBuilder = this.reportsRepository
      .createQueryBuilder('report')
      .leftJoinAndSelect('report.reporter', 'reporter')
      .leftJoinAndSelect('report.reviewer', 'reviewer')
      .where('report.status IN (...statuses)', {
        statuses: [ReportStatus.PENDING, ReportStatus.UNDER_REVIEW],
      })
      .orderBy('report.createdAt', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    if (query.targetType) {
      queryBuilder.andWhere('report.targetType = :targetType', {
        targetType: query.targetType,
      });
    }

    if (query.reviewerId !== undefined) {
      if (query.reviewerId === 'unassigned') {
        queryBuilder.andWhere('report.reviewerId IS NULL');
      } else {
        queryBuilder.andWhere('report.reviewerId = :reviewerId', {
          reviewerId: query.reviewerId,
        });
      }
    }

    const [reports, total] = await queryBuilder.getManyAndCount();
    const now = Date.now();

    const items: ModerationQueueItem[] = reports.map((report) => ({
      id: report.id,
      targetType: report.targetType,
      targetId: report.targetId,
      content: report.content ?? null,
      reporterId: report.reporterId,
      reporterName: report.reporter.displayName ?? report.reporterId,
      reason: report.reason,
      details: report.details ?? null,
      status: report.status,
      ageInSeconds: Math.floor((now - report.createdAt.getTime()) / 1000),
      createdAt: report.createdAt,
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Record a moderation decision with a required rationale
   */
  async recordDecision(
    id: string,
    moderatorId: string,
    decision: 'approve' | 'reject' | 'escalate',
    rationale: string,
  ): Promise<ContentReport> {
    if (!rationale || rationale.trim().length === 0) {
      throw new BadRequestException('A rationale is required for a moderation decision');
    }

    const report = await this.getReportById(id);
    const previousStatus = report.status;

    const statusByDecision: Record<typeof decision, ReportStatus> = {
      approve: ReportStatus.RESOLVED,
      reject: ReportStatus.DISMISSED,
      escalate: ReportStatus.UNDER_REVIEW,
    };

    report.status = statusByDecision[decision];
    report.reviewNotes = rationale;
    report.reviewerId = moderatorId;

    if (
      (report.status === ReportStatus.RESOLVED ||
        report.status === ReportStatus.DISMISSED) &&
      !report.resolvedAt
    ) {
      report.resolvedAt = new Date();
    }

    const updatedReport = await this.reportsRepository.save(report);

    await this.auditService.log(
      'moderation_decision',
      moderatorId,
      null,
      {
        reportId: id,
        decision,
        rationale,
        previousStatus,
        newStatus: updatedReport.status,
      },
    );

    this.logger.log(
      `Report ${id} decision '${decision}' by ${moderatorId}. Status: ${updatedReport.status}`,
    );

    if (previousStatus !== updatedReport.status) {
      const eventType = this.mapStatusToEventType(updatedReport.status);
      await this.eventPublisher.publishModerationEvent(
        eventType,
        updatedReport,
        previousStatus,
      );
    }

    return updatedReport;
  }

  /**
   * Get the decision history for an item, including who decided and when
   */
  async getDecisionHistory(
    id: string,
  ): Promise<ModerationDecisionHistoryEntry[]> {
    const report = await this.getReportById(id);

    const history = await this.auditService.findByTargetAndAction(
      'item',
      report.targetId,
      'moderation_decision',
    );

    return history.map((entry) => ({
      id: entry.id,
      reportId: (entry.metadata?.reportId as string) ?? report.id,
      decision: entry.metadata?.decision as 'approve' | 'reject' | 'escalate',
      rationale: (entry.metadata?.rationale as string) ?? '',
      decidedById: entry.actorId,
      decidedByName: entry.actorName ?? entry.actorId,
      decidedAt: entry.createdAt,
    }));
  }

  /**
   * Get reports submitted by a specific user
   */
  async getUserReports(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    reports: ContentReport[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [reports, total] = await this.reportsRepository.findAndCount({
      where: { reporterId: userId },
      relations: ['reviewer'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      reports,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Update report status and add review notes (moderator/admin only)
   */
  async updateReport(
    id: string,
    reviewerId: string,
    dto: UpdateReportDto,
  ): Promise<ContentReport> {
    const report = await this.getReportById(id);

    // Capture previous status before update
    const previousStatus = report.status;

    // Update fields
    if (dto.status) {
      report.status = dto.status;
    }

    if (dto.reviewNotes !== undefined) {
      report.reviewNotes = dto.reviewNotes;
    }

    report.reviewerId = reviewerId;

    // Set resolved timestamp if status is resolved or dismissed
    if (
      (dto.status === ReportStatus.RESOLVED ||
        dto.status === ReportStatus.DISMISSED) &&
      !report.resolvedAt
    ) {
      report.resolvedAt = new Date();
    }

    const updatedReport = await this.reportsRepository.save(report);
    this.logger.log(
      `Report ${id} updated by ${reviewerId}. Status: ${updatedReport.status}`,
    );

    // Emit event after successful database write (only if status changed)
    if (dto.status && previousStatus !== dto.status) {
      const eventType = this.mapStatusToEventType(dto.status);
      await this.eventPublisher.publishModerationEvent(
        eventType,
        updatedReport,
        previousStatus,
      );
    }

    return updatedReport;
  }

  /**
   * Map a ReportStatus to its corresponding event type
   */
  private mapStatusToEventType(
    status: ReportStatus,
  ):
    | 'moderation.pending'
    | 'moderation.under_review'
    | 'moderation.resolved'
    | 'moderation.dismissed' {
    const mapping = {
      [ReportStatus.PENDING]: 'moderation.pending' as const,
      [ReportStatus.UNDER_REVIEW]: 'moderation.under_review' as const,
      [ReportStatus.RESOLVED]: 'moderation.resolved' as const,
      [ReportStatus.DISMISSED]: 'moderation.dismissed' as const,
    };

    return mapping[status];
  }

  /**
   * Assign a reviewer to a report
   */
  async assignReviewer(
    id: string,
    assignerId: string,
    reviewerId?: string,
  ): Promise<ContentReport> {
    const report = await this.getReportById(id);

    report.reviewerId = reviewerId ?? assignerId;

    if (report.status === ReportStatus.PENDING) {
      report.status = ReportStatus.UNDER_REVIEW;
    }

    const updatedReport = await this.reportsRepository.save(report);

    this.logger.log(
      `Report ${id} assigned to reviewer ${reviewerId ?? assignerId} by ${assignerId}`,
    );

    return updatedReport;
  }
}
