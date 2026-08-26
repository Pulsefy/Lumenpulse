import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContributionJobPayload,
  ContributionFinding,
  DetectionRule,
} from '../types';

@Injectable()
export class ConcentrationRule implements DetectionRule {
  readonly name = 'ConcentrationRisk';

  constructor(private readonly config: ConfigService) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async evaluate(
    context: ContributionJobPayload,
  ): Promise<ContributionFinding | null> {
    const threshold = this.config.get<number>(
      'FRAUD_CONCENTRATION_THRESHOLD',
      0.5,
    );

    const roundTotal = Number(context.roundTotalContributions);
    if (roundTotal === 0) return null;

    const contributorTotal = Number(context.contributorTotalInRound);
    const percentage = contributorTotal / roundTotal;

    if (percentage <= threshold) return null;

    return {
      rule: this.name,
      description: `Wallet controls ${(percentage * 100).toFixed(1)}% of round total (threshold: ${(threshold * 100).toFixed(1)}%)`,
      metrics: { percentage, threshold, contributorTotal, roundTotal },
    };
  }
}
