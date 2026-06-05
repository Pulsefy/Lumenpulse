export interface VerifiedWebhookRequest {
  timestamp: number;
  nonce: string;
  requestId: string;
  verifiedAt: Date;
}

export interface SorobanWebhookConfig {
  secret: string;
  timestampToleranceMs: number;
}

export const SOROBAN_SIGNATURE_HEADER = 'x-soroban-signature';
export const SOROBAN_TIMESTAMP_HEADER = 'x-soroban-timestamp';
export const SOROBAN_NONCE_HEADER = 'x-soroban-nonce';
export const DEFAULT_TIMESTAMP_TOLERANCE_MS = 300_000;
