import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { AuditLog, AuditAction } from './entities/audit-log.entity';
import { AuditLogQueryDto, AuditLogListResponseDto } from './dto/audit-log.dto';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
  ) {}

  /**
   * Log a user action to the audit log
   */
  async logAction(
    userId: string,
    action: AuditAction,
    ipAddress?: string,
    userAgent?: string,
    metadata?: Record<string, unknown>,
    status?: string,
    details?: string,
  ): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create({
      userId,
      action,
      ipAddress,
      userAgent,
      metadata,
      status,
      details,
    });

    const saved = await this.auditLogRepository.save(auditLog);
    this.logger.debug(`Audit log created: ${action} for user ${userId}`);
    return saved;
  }

  /**
   * Get audit logs with filtering and pagination
   */
  async getAuditLogs(query: AuditLogQueryDto): Promise<AuditLogListResponseDto> {
    const {
      userId,
      action,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = query;

    const where: Record<string, unknown> = {};

    if (userId) {
      where.userId = userId;
    }

    if (action) {
      where.action = action;
    }

    if (startDate && endDate) {
      where.timestamp = Between(startDate, endDate);
    } else if (startDate) {
      where.timestamp = Between(startDate, new Date());
    } else if (endDate) {
      where.timestamp = Between(new Date(0), endDate);
    }

    const [data, total] = await this.auditLogRepository.findAndCount({
      where,
      order: { timestamp: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      total,
      page,
      limit,
    };
  }

  /**
   * Get audit logs for a specific user
   */
  async getUserAuditLogs(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<AuditLogListResponseDto> {
    return this.getAuditLogs({ userId, page, limit });
  }

  /**
   * Get recent audit logs for a user
   */
  async getRecentUserActivity(
    userId: string,
    limit = 10,
  ): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { userId },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }
}
