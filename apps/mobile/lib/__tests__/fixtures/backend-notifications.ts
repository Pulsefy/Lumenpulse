import { BackendNotificationType } from '../../deep-links';

/**
 * Backend notification payload fixtures (issue #1410).
 *
 * These mirror what the backend notification service actually emits:
 *  - `apps/backend/src/notification/notification.entity.ts` → `NotificationType`
 *    and `NotificationSeverity` enums.
 *  - `apps/backend/src/notification/notification-fanout.service.ts` → the
 *    persisted `metadata` bag (`...metadata, fanout: true, eventCategory`),
 *    where project-scoped events carry a `projectId` and asset-scoped events
 *    carry symbol fields (`symbol` / `symbols` / `tokenSymbol` / `assetSymbol`).
 *  - Expo push delivery wraps the backend payload in `notification.data`
 *    (see `NotificationDeliveryService.deliverPush` / the Expo push message
 *    shape consumed by `contexts/NotificationsContext.tsx`).
 *
 * If the backend changes a payload shape, these fixtures are the contract the
 * mobile deep-link tests validate against — update both sides together.
 */

/** Severity values emitted by the backend `NotificationSeverity` enum. */
export const BACKEND_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export type BackendSeverity = (typeof BACKEND_SEVERITIES)[number];

/**
 * Every `NotificationType` value declared by the backend
 * (`apps/backend/src/notification/notification.entity.ts`). The deep-link test
 * suite enumerates this list, so a newly added backend notification type must
 * be given a fixture (and therefore a resolved mobile screen) before it ships.
 */
export const BACKEND_NOTIFICATION_TYPES: BackendNotificationType[] = [
  'anomaly',
  'drift',
  'sentiment_spike',
  'system',
  'project',
  'contribution',
  'milestone',
  'governance',
  'token',
  'pool',
  'price',
  'module',
  'admin',
  'reputation',
];

/** Metadata bag emitted for project-scoped events (projectId present). */
export interface ProjectScopedMetadata {
  projectId: string;
  fanout: true;
  eventCategory: string;
}

/** Metadata bag emitted for asset-scoped events (symbol fields present). */
export interface AssetScopedMetadata {
  symbol: string;
  fanout: true;
  eventCategory: string;
}

/** Metadata bag emitted for system-scoped events (no entity reference). */
export interface SystemScopedMetadata {
  fanout: true;
  eventCategory: string;
}

/** Shape of a notification row served by `GET /notifications`. */
export interface BackendNotificationPayload {
  id: string;
  type: BackendNotificationType;
  title: string;
  message: string;
  severity: BackendSeverity;
  metadata: ProjectScopedMetadata | AssetScopedMetadata | SystemScopedMetadata;
  read: false;
  userId: string | null;
  createdAt: string;
}

/** Shape of an Expo push message (`notification.request.content`). */
export interface ExpoPushMessageFixture {
  title: string;
  body: string;
  /** The `data` bag the mobile app receives on tap. */
  data: Record<string, unknown>;
}

function basePayload(
  type: BackendNotificationType,
  metadata: ProjectScopedMetadata | AssetScopedMetadata | SystemScopedMetadata,
): BackendNotificationPayload {
  return {
    id: `00000000-0000-4000-8000-${String(BACKEND_NOTIFICATION_TYPES.indexOf(type)).padStart(12, '0')}`,
    type,
    title: `${type} notification`,
    message: `Fixture for backend "${type}" notification`,
    severity: 'medium',
    metadata,
    read: false,
    userId: '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-09-22T00:00:00.000Z',
  };
}

/**
 * One fixture per backend notification type, with the metadata shape the
 * fanout service actually persists for that category.
 */
export const BACKEND_NOTIFICATION_FIXTURES: Record<
  BackendNotificationType,
  BackendNotificationPayload
> = {
  project: basePayload('project', {
    projectId: 'proj_42',
    fanout: true,
    eventCategory: 'project',
  }),
  contribution: basePayload('contribution', {
    projectId: 'proj_42',
    fanout: true,
    eventCategory: 'contribution',
  }),
  milestone: basePayload('milestone', {
    projectId: 'proj_42',
    fanout: true,
    eventCategory: 'milestone',
  }),
  governance: basePayload('governance', {
    projectId: 'proj_42',
    fanout: true,
    eventCategory: 'governance',
  }),
  token: basePayload('token', { symbol: 'XLM', fanout: true, eventCategory: 'token' }),
  pool: basePayload('pool', { symbol: 'XLM', fanout: true, eventCategory: 'pool' }),
  price: basePayload('price', { symbol: 'XLM', fanout: true, eventCategory: 'price' }),
  anomaly: basePayload('anomaly', { fanout: true, eventCategory: 'system' }),
  drift: basePayload('drift', { fanout: true, eventCategory: 'system' }),
  sentiment_spike: basePayload('sentiment_spike', { fanout: true, eventCategory: 'system' }),
  system: basePayload('system', { fanout: true, eventCategory: 'system' }),
  module: basePayload('module', { fanout: true, eventCategory: 'module' }),
  admin: basePayload('admin', { fanout: true, eventCategory: 'admin' }),
  reputation: basePayload('reputation', { fanout: true, eventCategory: 'reputation' }),
};

/**
 * Converts a backend notification row into the Expo push message the mobile
 * app receives — the same projection the backend push delivery performs when
 * it forwards the persisted notification to Expo.
 */
export function toExpoPushMessage(payload: BackendNotificationPayload): ExpoPushMessageFixture {
  return {
    title: payload.title,
    body: payload.message,
    data: {
      type: payload.type,
      ...payload.metadata,
    },
  };
}
