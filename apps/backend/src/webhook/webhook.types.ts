/**
 * Supported signature algorithms for webhook verification
 */
export enum WebhookSignatureAlgorithm {
  HMAC_SHA256 = 'hmac-sha256',
  HMAC_SHA512 = 'hmac-sha512',
  RSA_SHA256 = 'rsa-sha256',
  ED25519 = 'ed25519',
}

/**
 * Configuration for a webhook provider
 */
export interface WebhookProviderConfig {
  /** Unique provider identifier */
  name: string;

  /** Signature algorithm to use */
  algorithm: WebhookSignatureAlgorithm;

  /** Secret key for HMAC algorithms */
  secret?: string;

  /** Public key for RSA/Ed25519 algorithms (base64 encoded) */
  publicKey?: string;

  /** Whether this provider is enabled */
  enabled: boolean;

  /** Timestamp tolerance in milliseconds for replay protection (optional) */
  timestampToleranceMs?: number;

  /** Expected header name for signature (default: X-Webhook-Signature) */
  signatureHeader?: string;

  /** Expected header name for timestamp (optional) */
  timestampHeader?: string;

  /** Allowed IP addresses for this provider (optional) */
  allowedIps?: string[];
}

/**
 * Result of webhook signature verification
 */
export interface WebhookVerificationResult {
  /** Whether the signature is valid */
  valid: boolean;

  /** Error message if verification failed */
  error?: string;

  /** Provider name */
  provider: string;

  /** Algorithm used for verification */
  algorithm?: WebhookSignatureAlgorithm;

  /** Timestamp when verification occurred */
  verifiedAt?: Date;
}

/**
 * Event types that can trigger notifications
 */
export enum WebhookEventType {
  ANOMALY = 'anomaly',
  SENTIMENT_SPIKE = 'sentiment_spike',
  SYSTEM_ALERT = 'system_alert',
  PRICE_THRESHOLD = 'price_threshold',
  PORTFOLIO_UPDATE = 'portfolio_update',
  CUSTOM = 'custom',
}

/**
 * Standard webhook payload structure
 */
export interface StandardWebhookPayload {
  /** Event type */
  event: string;

  /** Event type category */
  type: WebhookEventType | string;

  /** Event timestamp (ISO 8601) */
  timestamp?: string;

  /** Event-specific data */
  data?: Record<string, unknown>;

  /** Metadata about the event */
  metadata?: Record<string, unknown>;
}
