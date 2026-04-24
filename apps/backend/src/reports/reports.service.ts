import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Report, ReportStatus, ContentType } from './entities/report.entity';
import { User } from '../users/user.entity';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report)
    private readonly reportRepository: Repository<Report>,
  ) {}

  async createReport(
    reporterId: number,
    contentType: ContentType,
    contentId: string,
    reason: string,
    description?: string,
  ): Promise<Report> {
    const report = this.reportRepository.create({
      reporterId,
      contentType,
      contentId,
      reason,
      description,
    });
    return this.reportRepository.save(report);
  }

  async getPendingReports(): Promise<Report[]> {
    return this.reportRepository.find({
      where: { status: ReportStatus.PENDING },
      relations: ['reporter'],
      order: { createdAt: 'DESC' },
    });
  }

  async updateReportStatus(
    id: number,
    status: ReportStatus,
    reviewedBy?: number,
    reviewNotes?: string,
  ): Promise<Report> {
    await this.reportRepository.update(id, {
      status,
      reviewedBy,
      reviewNotes,
      updatedAt: new Date(),
    });
    return this.reportRepository.findOne({ where: { id } });
  }

  async getReportById(id: number): Promise<Report> {
    return this.reportRepository.findOne({
      where: { id },
      relations: ['reporter'],
    });
  }
}