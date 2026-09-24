export enum ExportType {
  PORTFOLIO_HISTORY = 'portfolio_history',
  TAX_TRANSACTIONS = 'tax_transactions',
}

export enum ExportStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface ExportJob {
  id: string;
  type: ExportType;
  status: ExportStatus;
  createdAt: Date | string;
  updatedAt: Date | string;
  errorMessage?: string;
}

export interface CreateExportJobRequest {
  type: ExportType;
}

export interface ExportJobsResponse extends Array<ExportJob> {}
