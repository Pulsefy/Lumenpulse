export type SnapshotTriggerSource = 'cron' | 'manual';

export interface PortfolioSnapshotBatchJobData {
  triggeredBy: SnapshotTriggerSource;
  requestedAt: string;
}

export interface PortfolioSnapshotUserJobData {
  userId: string;
  batchId: string;
}

export interface PortfolioSnapshotBatchStatus {
  batchId: string;
  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'completed_with_errors'
    | 'failed';
  total: number;
  completed: number;
  failed: number;
  progressPercent: number;
  triggeredBy?: SnapshotTriggerSource | 'unknown';
  requestedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}
