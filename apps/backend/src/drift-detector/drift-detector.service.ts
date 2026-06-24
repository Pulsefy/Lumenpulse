import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ComparisonService } from './comparators/comparison.service';
import { DriftReport } from './entities/drift-report.entity';
import { DriftSuppression } from './entities/drift-suppression.entity';
import {
  DriftRecord,
  DriftSeverity,
  DriftType,
  DriftReportResult,
  DRIFT_SEVERITY_ORDER,
} from './interfaces/drift.types';

@Injectable()
export class DriftDetectorService {
  private readonly logger = new Logger(DriftDetectorService.name);

  constructor(
    @InjectRepository(DriftReport)
    private readonly reportRepo: Repository<DriftReport>,
    @InjectRepository(DriftSuppression)
    private readonly suppressionRepo: Repository<DriftSuppression>,
    private readonly comparisonService: ComparisonService,
  ) {}

  async runDetection(triggeredBy = 'scheduled'): Promise<DriftReport> {
    const startTime = Date.now();

    const report = await this.reportRepo.save(
      this.reportRepo.create({
        triggeredBy,
        status: 'running',
      }),
    );

    this.logger.log(`Drift detection ${report.id} started (triggeredBy=${triggeredBy})`);

    try {
      const portfolioDrifts = await this.comparisonService.compareAllUsers();
      const projectDrifts = await this.comparisonService.compareProjectRegistry();

      const allDrifts = [...portfolioDrifts, ...projectDrifts];

      const criticalCount = allDrifts.filter((d) => d.severity === DriftSeverity.CRITICAL).length;
      const highCount = allDrifts.filter((d) => d.severity === DriftSeverity.HIGH).length;
      const mediumCount = allDrifts.filter((d) => d.severity === DriftSeverity.MEDIUM).length;
      const lowCount = allDrifts.filter((d) => d.severity === DriftSeverity.LOW).length;

      const driftsByType: Record<string, number> = {};
      for (const d of allDrifts) {
        driftsByType[d.driftType] = (driftsByType[d.driftType] ?? 0) + 1;
      }

      const durationMs = Date.now() - startTime;

      report.status = 'completed';
      report.totalScanned = await this.countScanned();
      report.totalDrifts = allDrifts.length;
      report.criticalCount = criticalCount;
      report.highCount = highCount;
      report.mediumCount = mediumCount;
      report.lowCount = lowCount;
      report.drifts = allDrifts.length > 0 ? allDrifts : null;
      report.summary = {
        driftsByType,
        driftsBySeverity: {
          CRITICAL: criticalCount,
          HIGH: highCount,
          MEDIUM: mediumCount,
          LOW: lowCount,
        },
        highestSeverity: this.computeHighestSeverity(allDrifts),
      };
      report.finishedAt = new Date();
      report.durationMs = durationMs;

      this.logger.log(
        `Drift detection ${report.id} complete — ` +
        `totalDrifts=${allDrifts.length} (critical=${criticalCount} high=${highCount} medium=${mediumCount} low=${lowCount})`,
      );

      return this.reportRepo.save(report);
    } catch (err) {
      report.status = 'failed';
      report.errorMessage = err instanceof Error ? err.message : String(err);
      report.finishedAt = new Date();
      report.durationMs = Date.now() - startTime;

      this.logger.error(`Drift detection ${report.id} failed: ${report.errorMessage}`);

      return this.reportRepo.save(report);
    }
  }

  private computeHighestSeverity(drifts: DriftRecord[]): DriftSeverity | null {
    if (drifts.length === 0) return null;

    let highest: DriftSeverity = DriftSeverity.LOW;
    for (const d of drifts) {
      if (DRIFT_SEVERITY_ORDER[d.severity] > DRIFT_SEVERITY_ORDER[highest]) {
        highest = d.severity;
      }
    }
    return highest;
  }

  private async countScanned(): Promise<number> {
    const counts = await this.comparisonService.countCandidates();
    return counts.usersWithKeys + counts.projects;
  }

  async getRecentReports(limit = 20): Promise<DriftReport[]> {
    return this.reportRepo.find({
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }

  async getReportById(id: string): Promise<DriftReport | null> {
    return this.reportRepo.findOne({ where: { id } });
  }

  async suppressDrift(
    entityType: string,
    entityId: string,
    field: string,
    reason?: string,
    suppressedBy?: string,
    expiresAt?: Date,
  ): Promise<DriftSuppression> {
    const existing = await this.suppressionRepo.findOne({
      where: { entityType, entityId, field },
    });

    if (existing) {
      existing.reason = reason ?? existing.reason;
      existing.suppressedBy = suppressedBy ?? existing.suppressedBy;
      existing.expiresAt = expiresAt ?? existing.expiresAt;
      return this.suppressionRepo.save(existing);
    }

    return this.suppressionRepo.save(
      this.suppressionRepo.create({
        entityType,
        entityId,
        field,
        reason: reason ?? null,
        suppressedBy: suppressedBy ?? null,
        expiresAt: expiresAt ?? null,
      }),
    );
  }

  async removeSuppression(
    entityType: string,
    entityId: string,
    field: string,
  ): Promise<boolean> {
    const result = await this.suppressionRepo.delete({
      entityType,
      entityId,
      field,
    });
    return (result.affected ?? 0) > 0;
  }

  async listSuppressions(): Promise<DriftSuppression[]> {
    return this.suppressionRepo.find({
      order: { createdAt: 'DESC' },
    });
  }
}
