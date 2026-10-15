import { Injectable, Logger } from '@nestjs/common';
import {
  ContributionJobPayload,
  ContributionFinding,
  DetectionRule,
} from './types';

@Injectable()
export class DetectionService {
  private readonly logger = new Logger(DetectionService.name);

  constructor(private readonly rules: DetectionRule[]) {}

  async detect(
    payload: ContributionJobPayload,
  ): Promise<ContributionFinding[]> {
    const findings: ContributionFinding[] = [];

    for (const rule of this.rules) {
      try {
        const finding = await rule.evaluate(payload);
        if (finding) {
          findings.push(finding);
          this.logger.log(`Rule triggered: ${finding.rule}`);
        }
      } catch (err) {
        this.logger.error(
          `Rule ${rule.name} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return findings;
  }
}
