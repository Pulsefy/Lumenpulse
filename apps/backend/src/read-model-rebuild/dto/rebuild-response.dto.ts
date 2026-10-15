import { ApiProperty } from '@nestjs/swagger';
import {
  RebuildStatus,
  RebuildDataset,
} from '../entities/read-model-rebuild-job.entity';

export class RebuildResponseDto {
  @ApiProperty({ description: 'Job ID for tracking' })
  id: string;

  @ApiProperty({ enum: RebuildDataset })
  dataset: RebuildDataset;

  @ApiProperty({ nullable: true })
  contractId: string | null;

  @ApiProperty({ enum: RebuildStatus })
  status: RebuildStatus;

  @ApiProperty({ nullable: true })
  triggerReason: string | null;

  @ApiProperty({ nullable: true })
  triggeredBy: string | null;

  @ApiProperty()
  totalItems: number;

  @ApiProperty()
  processedItems: number;

  @ApiProperty()
  failedItems: number;

  @ApiProperty({ nullable: true })
  progressDetails: Record<string, unknown> | null;

  @ApiProperty({ nullable: true })
  errorMessage: string | null;

  @ApiProperty({ nullable: true })
  startedAt: Date | null;

  @ApiProperty({ nullable: true })
  completedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ description: 'Progress percentage (0-100)' })
  get progressPercentage(): number {
    if (this.totalItems === 0) return 0;
    return Math.round((this.processedItems / this.totalItems) * 100);
  }

  @ApiProperty({ description: 'Estimated time remaining in seconds' })
  get estimatedTimeRemaining(): number | null {
    if (this.status !== RebuildStatus.IN_PROGRESS || !this.startedAt) {
      return null;
    }
    const elapsed = Date.now() - this.startedAt.getTime();
    if (this.processedItems === 0) return null;
    const avgTimePerItem = elapsed / this.processedItems;
    const remaining = this.totalItems - this.processedItems;
    return Math.round((avgTimePerItem * remaining) / 1000);
  }
}

export class RebuildStatusResponseDto extends RebuildResponseDto {
  @ApiProperty({ description: 'Whether the job is in a terminal state' })
  isTerminal: boolean;

  @ApiProperty({ description: 'Human-readable status message' })
  statusMessage: string;
}

export class RebuildTriggerResponseDto {
  @ApiProperty({ description: 'Job ID for tracking' })
  jobId: string;

  @ApiProperty({ description: 'Status of the trigger request' })
  status: string;

  @ApiProperty({ description: 'Message describing the result' })
  message: string;

  @ApiProperty({ description: 'Whether a new rebuild was started' })
  started: boolean;

  @ApiProperty({ description: 'Reference to existing job if duplicate' })
  existingJobId?: string;
}
