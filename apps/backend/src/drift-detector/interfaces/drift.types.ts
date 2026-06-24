export enum DriftType {
  STATUS_MISMATCH = 'STATUS_MISMATCH',
  BALANCE_MISMATCH = 'BALANCE_MISMATCH',
  SEQUENCE_MISMATCH = 'SEQUENCE_MISMATCH',
  MISSING_ON_CHAIN = 'MISSING_ON_CHAIN',
  MISSING_IN_BACKEND = 'MISSING_IN_BACKEND',
  FIELD_MISMATCH = 'FIELD_MISMATCH',
}

export enum DriftSeverity {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export const DRIFT_SEVERITY_ORDER: Record<DriftSeverity, number> = {
  [DriftSeverity.CRITICAL]: 4,
  [DriftSeverity.HIGH]: 3,
  [DriftSeverity.MEDIUM]: 2,
  [DriftSeverity.LOW]: 1,
};

export interface DriftRecord {
  entityType: string;
  entityId: string;
  field: string;
  driftType: DriftType;
  severity: DriftSeverity;
  storedValue: unknown;
  onChainValue: unknown;
  detail: string;
}

export interface DriftReportResult {
  totalScanned: number;
  totalDrifts: number;
  driftsBySeverity: Record<DriftSeverity, number>;
  driftsByType: Record<DriftType, number>;
  drifts: DriftRecord[];
  durationMs: number;
}

export interface PortfolioAssetOnChain {
  assetCode: string;
  assetIssuer: string | null;
  balance: string;
}

export interface ProjectRegistryOnChain {
  owner: string;
  name: string;
  status: string;
  metadataCid: string | null;
  lastLedgerSeq: number;
}
