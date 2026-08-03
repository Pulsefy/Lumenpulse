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

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    @InjectRepository(ContentReport)
    private reportsRepository: Repository<ContentReport>,
    private readonly eventPublisher: ModerationEventPublisherService,
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
      .andWhere('report.status IN (:...statuses)', {
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
   * Get moderation queue statistics
   */
  async getModerationStats(): Promise<{
    totalReports: number;
    pendingReports: number;
    underReviewReports: number;
    resolvedReports: number;
    dismissedReports: number;
  }> {
    const [
      totalReports,
      pendingReports,
      underReviewReports,
      resolvedReports,
      dismissedReports,
    ] = await Promise.all([
      this.reportsRepository.count(),
      this.reportsRepository.count({ where: { status: ReportStatus.PENDING } }),
      this.reportsRepository.count({
        where: { status: ReportStatus.UNDER_REVIEW },
      }),
      this.reportsRepository.count({
        where: { status: ReportStatus.RESOLVED },
      }),
      this.reportsRepository.count({
        where: { status: ReportStatus.DISMISSED },
      }),
    ]);

    return {
      totalReports,
      pendingReports,
      underReviewReports,
      resolvedReports,
      dismissedReports,
    };
  }
}
