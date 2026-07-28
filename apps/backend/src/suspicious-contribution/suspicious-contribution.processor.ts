import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DetectionService } from './detection.service';
import { ModerationService } from '../moderation/moderation.service';
import { ContributionJobPayload, CONTRIBUTION_QUEUE } from './types';
import {
  ReportType,
  ReportReason,
} from '../moderation/entities/content-report.entity';

const SYSTEM_REPORTER = 'system-fraud-detector';

@Processor(CONTRIBUTION_QUEUE, { concurrency: 1 })
@Injectable()
export class SuspiciousContributionProcessor extends WorkerHost {
  private readonly logger = new Logger(SuspiciousContributionProcessor.name);

  constructor(
    private readonly detectionService: DetectionService,
    private readonly moderationService: ModerationService,
  ) {
    super();
  }

  async process(
    job: Job<ContributionJobPayload>,
  ): Promise<{ flagged: boolean; findingCount: number }> {
    const payload = job.data;
    this.logger.debug(
      `Processing fraud detection for contribution in round ${payload.roundId}`,
    );

    const findings = await this.detectionService.detect(payload);

    if (findings.length === 0) {
      return { flagged: false, findingCount: 0 };
    }

    const description = this.formatDescription(payload, findings);

    try {
      await this.moderationService.createReport(SYSTEM_REPORTER, {
        targetType: ReportType.PROJECT,
        targetId: String(payload.projectId),
        reason: ReportReason.FRAUD,
        description,
      });
    } catch (err) {
      if (err instanceof BadRequestException) {
        this.logger.debug(
          `Report already exists for project ${payload.projectId}, skipping`,
        );
        return { flagged: true, findingCount: findings.length };
      }
      throw err;
    }

    this.logger.log(
      `Flagged contribution: round=${payload.roundId} project=${payload.projectId} contributor=${payload.contributorPublicKey} rules=${findings.length}`,
    );

    return { flagged: true, findingCount: findings.length };
  }

  private formatDescription(
    payload: ContributionJobPayload,
    findings: {
      rule: string;
      description: string;
      metrics: Record<string, unknown>;
    }[],
  ): string {
    const lines = [
      'Suspicious Contribution Detection',
      '',
      'Triggered Rules',
      '',
    ];

    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      lines.push(`${i + 1}. ${f.rule}`);
      lines.push('');
      lines.push(`Observed: ${f.description}`);
      lines.push('');
      if (i < findings.length - 1) {
        lines.push('---');
        lines.push('');
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`Contributor: ${payload.contributorPublicKey}`);
    lines.push(`Round: ${payload.roundId}`);
    lines.push(`Project: ${payload.projectId}`);

    return lines.join('\n');
  }
}
