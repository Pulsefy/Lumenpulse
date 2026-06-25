import {
  CanonicalEventType,
} from './event-catalog';
import { NotificationType } from '../notification/notification.entity';
import { WebhookEventType } from '../webhook/webhook.types';

const CANONICAL_TO_NOTIFICATION: Record<string, NotificationType> = {
  [CanonicalEventType.PROJECT_CREATED]: NotificationType.PROJECT,
  [CanonicalEventType.PROJECT_VERIFIED]: NotificationType.PROJECT,
  [CanonicalEventType.PROJECT_REJECTED]: NotificationType.PROJECT,
  [CanonicalEventType.PROJECT_CANCELED]: NotificationType.PROJECT,
  [CanonicalEventType.PROJECT_EXPIRED]: NotificationType.PROJECT,
  [CanonicalEventType.PROJECT_PROPOSED]: NotificationType.PROJECT,
  [CanonicalEventType.CONTRIBUTION_DEPOSITED]: NotificationType.CONTRIBUTION,
  [CanonicalEventType.CONTRIBUTION_REFUNDED]: NotificationType.CONTRIBUTION,
  [CanonicalEventType.CONTRIBUTION_PAID_OUT]: NotificationType.CONTRIBUTION,
  [CanonicalEventType.CONTRIBUTION_CLAWED_BACK]: NotificationType.CONTRIBUTION,
  [CanonicalEventType.FEE_DEDUCTED]: NotificationType.CONTRIBUTION,
  [CanonicalEventType.MILESTONE_APPROVED]: NotificationType.MILESTONE,
  [CanonicalEventType.MILESTONE_APPROVED_BY_VOTE]: NotificationType.MILESTONE,
  [CanonicalEventType.MILESTONE_DISPUTED]: NotificationType.MILESTONE,
  [CanonicalEventType.MILESTONE_DISPUTE_RESOLVED]: NotificationType.MILESTONE,
  [CanonicalEventType.MILESTONE_VOTE_STARTED]: NotificationType.MILESTONE,
  [CanonicalEventType.MILESTONE_VOTE_CAST]: NotificationType.MILESTONE,
  [CanonicalEventType.GOVERNANCE_PROPOSAL_CREATED]: NotificationType.GOVERNANCE,
  [CanonicalEventType.GOVERNANCE_PROPOSAL_EXECUTED]: NotificationType.GOVERNANCE,
  [CanonicalEventType.GOVERNANCE_PROPOSAL_CANCELLED]: NotificationType.GOVERNANCE,
  [CanonicalEventType.GOVERNANCE_PROPOSAL_EXPIRED]: NotificationType.GOVERNANCE,
  [CanonicalEventType.GOVERNANCE_SIGNATURE_COLLECTED]: NotificationType.GOVERNANCE,
  [CanonicalEventType.GOVERNANCE_MULTISIG_CONFIGURED]: NotificationType.GOVERNANCE,
  [CanonicalEventType.TOKEN_BURNED]: NotificationType.TOKEN,
  [CanonicalEventType.TOKEN_VESTING_CREATED]: NotificationType.TOKEN,
  [CanonicalEventType.TOKEN_CLAIMED]: NotificationType.TOKEN,
  [CanonicalEventType.TOKEN_STREAM_CREATED]: NotificationType.TOKEN,
  [CanonicalEventType.TOKEN_DELEGATE_APPROVED]: NotificationType.TOKEN,
  [CanonicalEventType.TOKEN_DELEGATE_REVOKED]: NotificationType.TOKEN,
  [CanonicalEventType.TOKEN_DELEGATED_CLAIM]: NotificationType.TOKEN,
  [CanonicalEventType.POOL_ROUND_CREATED]: NotificationType.POOL,
  [CanonicalEventType.POOL_FUNDED]: NotificationType.POOL,
  [CanonicalEventType.POOL_PROJECT_APPROVED]: NotificationType.POOL,
  [CanonicalEventType.POOL_PROJECT_REMOVED]: NotificationType.POOL,
  [CanonicalEventType.POOL_CONTRIBUTION_RECORDED]: NotificationType.POOL,
  [CanonicalEventType.POOL_ROUND_FINALIZED]: NotificationType.POOL,
  [CanonicalEventType.POOL_MATCH_DISTRIBUTED]: NotificationType.POOL,
  [CanonicalEventType.POOL_ALL_MATCHES_DISTRIBUTED]: NotificationType.POOL,
  [CanonicalEventType.PRICE_UPDATED]: NotificationType.PRICE,
  [CanonicalEventType.PRICE_ORACLE_UPDATED]: NotificationType.PRICE,
  [CanonicalEventType.MODULE_REGISTERED]: NotificationType.MODULE,
  [CanonicalEventType.MODULE_UPDATED]: NotificationType.MODULE,
  [CanonicalEventType.MODULE_DEACTIVATED]: NotificationType.MODULE,
  [CanonicalEventType.MODULE_ACTIVATED]: NotificationType.MODULE,
  [CanonicalEventType.ADMIN_UPGRADED]: NotificationType.ADMIN,
  [CanonicalEventType.ADMIN_CHANGED]: NotificationType.ADMIN,
  [CanonicalEventType.ADMIN_TRANSFERRED]: NotificationType.ADMIN,
  [CanonicalEventType.ADMIN_PAUSED]: NotificationType.ADMIN,
  [CanonicalEventType.ADMIN_UNPAUSED]: NotificationType.ADMIN,
  [CanonicalEventType.ADMIN_FEE_CONFIG_CHANGED]: NotificationType.ADMIN,
  [CanonicalEventType.ADMIN_STORAGE_MIGRATED]: NotificationType.ADMIN,
  [CanonicalEventType.ADMIN_VERIFICATION_OVERRIDDEN]: NotificationType.ADMIN,
  [CanonicalEventType.REPUTATION_UPDATED]: NotificationType.REPUTATION,
  [CanonicalEventType.REPUTATION_BADGE_GRANTED]: NotificationType.REPUTATION,
  [CanonicalEventType.REPUTATION_BADGE_REVOKED]: NotificationType.REPUTATION,
  [CanonicalEventType.REPUTATION_PENALTY_APPLIED]: NotificationType.REPUTATION,
  [CanonicalEventType.SYSTEM_ANOMALY]: NotificationType.ANOMALY,
  [CanonicalEventType.SYSTEM_SENTIMENT_SPIKE]: NotificationType.SENTIMENT_SPIKE,
  [CanonicalEventType.SYSTEM_ALERT]: NotificationType.SYSTEM,
};

const CANONICAL_TO_WEBHOOK: Record<string, WebhookEventType> = {
  [CanonicalEventType.SYSTEM_ANOMALY]: WebhookEventType.ANOMALY,
  [CanonicalEventType.SYSTEM_SENTIMENT_SPIKE]: WebhookEventType.SENTIMENT_SPIKE,
  [CanonicalEventType.SYSTEM_ALERT]: WebhookEventType.SYSTEM_ALERT,
  [CanonicalEventType.PRICE_UPDATED]: WebhookEventType.PRICE_THRESHOLD,
  [CanonicalEventType.PRICE_ORACLE_UPDATED]: WebhookEventType.PRICE_THRESHOLD,
};

export function canonicalToNotificationType(
  canonicalType: string,
): NotificationType | null {
  return CANONICAL_TO_NOTIFICATION[canonicalType] ?? null;
}

export function canonicalToWebhookType(
  canonicalType: string,
): WebhookEventType | null {
  return CANONICAL_TO_WEBHOOK[canonicalType] ?? null;
}
