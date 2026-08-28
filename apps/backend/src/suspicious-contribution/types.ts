export const CONTRIBUTION_QUEUE = 'suspicious-contribution';
export const DETECTION_JOB = 'detect';

export interface ContributionJobPayload {
  roundId: number;
  projectId: number;
  contributorPublicKey: string;
  amount: string;
  roundTotalContributions: string;
  contributorTotalInRound: string;
}

export interface ContributionFinding {
  rule: string;
  description: string;
  metrics: Record<string, unknown>;
}

export interface DetectionRule {
  readonly name: string;
  evaluate(
    context: ContributionJobPayload,
  ): Promise<ContributionFinding | null>;
}

export interface FraudDetectionConfig {
  largeAmountThreshold: number;
  burstWindowSeconds: number;
  burstThreshold: number;
  concentrationThreshold: number;
}
