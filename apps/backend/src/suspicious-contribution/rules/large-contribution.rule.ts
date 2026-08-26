import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContributionJobPayload,
  ContributionFinding,
  DetectionRule,
} from '../types';

@Injectable()
export class LargeContributionRule implements DetectionRule {
  readonly name = 'LargeContribution';

  constructor(private readonly config: ConfigService) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async evaluate(
    context: ContributionJobPayload,
  ): Promise<ContributionFinding | null> {
    const threshold = this.config.get<number>(
      'FRAUD_LARGE_AMOUNT_THRESHOLD',
      10000,
    );
    const amount = Number(context.amount);

    if (amount <= threshold) return null;

    return {
      rule: this.name,
      description: `Contribution amount ${amount} exceeds threshold of ${threshold}`,
      metrics: { amount, threshold },
    };
  }
}
