import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ModerationService } from './moderation.service';
import { CrowdfundService } from '../crowdfund/crowdfund.service';
import { ReportReason, ReportType } from './entities/content-report.entity';

interface ContributionJobData {
  projectId: number;
  senderPublicKey: string;
  amount: string;
  timestamp: string;
  transactionHash: string;
}

@Processor('contribution-moderation')
@Injectable()
export class ContributionModerationProcessor extends WorkerHost {
  private readonly logger = new Logger(ContributionModerationProcessor.name);

  constructor(
    private readonly moderationService: ModerationService,
    private readonly crowdfundService: CrowdfundService,
  ) {
    super();
  }

  async process(job: Job<ContributionJobData>): Promise<void> {
    const { projectId, senderPublicKey, amount, timestamp, transactionHash } =
      job.data;

    this.logger.debug(
      `Processing contribution moderation job: project=${projectId} tx=${transactionHash}`,
    );

    try {
      const systemUser = await this.moderationService.getOrCreateSystemUser();
      const allContributions =
        this.crowdfundService.getAllContributions(projectId);
      const project = this.crowdfundService.getProject(projectId);

      const targetTime = new Date(timestamp).getTime();

      // Rule 1: Velocity Alert (> 5 contributions within 10s window)
      const tenSecondsAgo = targetTime - 10000;
      const contributionsInTenSec = allContributions.filter(
        (c) =>
          c.timestamp.getTime() >= tenSecondsAgo &&
          c.timestamp.getTime() <= targetTime,
      );
      if (contributionsInTenSec.length > 5) {
        const rationale = `Velocity Alert: Project received ${contributionsInTenSec.length} contributions within 10 seconds (limit is 5). Violating tx: ${transactionHash}`;
        this.logger.warn(rationale);
        await this.moderationService.createReport(systemUser.id, {
          targetType: ReportType.PROJECT,
          targetId: String(projectId),
          reason: ReportReason.FRAUD,
          description: rationale,
        });
      }

      // Rule 2: Wallet Spammer Alert (> 3 contributions from same wallet within 15s window)
      const fifteenSecondsAgo = targetTime - 15000;
      const walletContributionsInFifteenSec = allContributions.filter(
        (c) =>
          c.publicKey === senderPublicKey &&
          c.timestamp.getTime() >= fifteenSecondsAgo &&
          c.timestamp.getTime() <= targetTime,
      );
      if (walletContributionsInFifteenSec.length > 3) {
        const rationale = `Wallet Spam Alert: Wallet ${senderPublicKey} made ${walletContributionsInFifteenSec.length} contributions to Project ${projectId} within 15 seconds (limit is 3). Violating tx: ${transactionHash}`;
        this.logger.warn(rationale);
        await this.moderationService.createReport(systemUser.id, {
          targetType: ReportType.USER,
          targetId: senderPublicKey,
          reason: ReportReason.SPAM,
          description: rationale,
        });
      }

      // Rule 3: Large Contribution Alert (> 10,000 XLM or > 50% of project target amount)
      const contribAmount = parseFloat(amount);
      const targetAmount = parseFloat(project.targetAmount);
      const exceedsPercent =
        targetAmount > 0 && contribAmount > targetAmount * 0.5;
      const exceedsAbsolute = contribAmount > 10000;

      if (exceedsPercent || exceedsAbsolute) {
        let rationale = '';
        if (exceedsPercent && exceedsAbsolute) {
          rationale = `Large Amount Alert: Contribution of ${amount} XLM exceeds both 10,000 XLM and 50% of Project ${projectId}'s target of ${project.targetAmount} XLM. Violating tx: ${transactionHash}`;
        } else if (exceedsPercent) {
          rationale = `Large Amount Alert: Contribution of ${amount} XLM exceeds 50% of Project ${projectId}'s target of ${project.targetAmount} XLM. Violating tx: ${transactionHash}`;
        } else {
          rationale = `Large Amount Alert: Contribution of ${amount} XLM exceeds the limit of 10,000 XLM. Violating tx: ${transactionHash}`;
        }
        this.logger.warn(rationale);
        await this.moderationService.createReport(systemUser.id, {
          targetType: ReportType.PROJECT,
          targetId: String(projectId),
          reason: ReportReason.FRAUD,
          description: rationale,
        });
      }

      // Rule 4: Coordinated Multi-Wallet Alert (> 4 unique wallets within 30s window)
      const thirtySecondsAgo = targetTime - 30000;
      const contributionsInThirtySec = allContributions.filter(
        (c) =>
          c.timestamp.getTime() >= thirtySecondsAgo &&
          c.timestamp.getTime() <= targetTime,
      );
      const uniqueWallets = new Set(
        contributionsInThirtySec.map((c) => c.publicKey),
      );
      if (uniqueWallets.size > 4) {
        const rationale = `Coordinated Multi-Wallet Alert: ${uniqueWallets.size} unique wallets contributed to Project ${projectId} within 30 seconds (limit is 4). Violating tx: ${transactionHash}`;
        this.logger.warn(rationale);
        await this.moderationService.createReport(systemUser.id, {
          targetType: ReportType.PROJECT,
          targetId: String(projectId),
          reason: ReportReason.FRAUD,
          description: rationale,
        });
      }
    } catch (err) {
      this.logger.error(
        `Error processing contribution moderation job: ${err.message}`,
        err.stack,
      );
      throw err;
    }
  }
}
