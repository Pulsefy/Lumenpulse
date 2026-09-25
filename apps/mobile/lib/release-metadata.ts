import Constants from 'expo-constants';
import { Platform } from 'react-native';

export interface ReleaseInfo {
  version: string;
  date: string;
  title: string;
  notes: string[];
}

export interface ReleaseMetadata {
  releases: ReleaseInfo[];
}

export type UpdateChannel = 'development' | 'preview' | 'production' | 'unknown';

export type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'roll-back-available'
  | 'error'
  | 'unsupported';

export interface RuntimeUpdateInfo {
  runtimeVersion: string;
  updateId: string | null;
  channel: UpdateChannel;
  createdAt: string | null;
  isEmbedded: boolean;
}

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  message: string | null;
  newUpdateId: string | null;
  createdAt: string | null;
}

export interface DiagnosticsContext {
  environment: string;
  environmentLabel: string;
  apiBaseUrl: string | null;
  stellarNetwork: string | null;
  sorobanRpcUrl: string | null;
  crowdfundContractId: string | null;
  connectionStatus?: 'idle' | 'testing' | 'online' | 'offline';
  lastCheckedAt?: string | null;
}

export const fallbackReleaseMetadata: ReleaseMetadata = {
  releases: [
    {
      version: '1.0.0',
      date: '2026-07-24',
      title: 'Initial MVP Release (Fallback)',
      notes: [
        'Active environment check for Testnet and Mainnet.',
        'Network context status indicators.',
        'Basic wallet and notification settings.'
      ]
    }
  ]
};

export function getReleaseMetadata(): ReleaseMetadata {
  try {
    const metadata = require('../assets/release-metadata.json');
    if (metadata && Array.isArray(metadata.releases)) {
      return metadata as ReleaseMetadata;
    }
  } catch (error) {
    console.warn('Unable to load release metadata, using fallback:', error);
  }
  return fallbackReleaseMetadata;
}

function safeExtractChannel(raw: unknown): UpdateChannel {
  if (typeof raw !== 'string' || !raw) return 'unknown';
  const lower = raw.toLowerCase();
  if (lower === 'production' || lower === 'prod') return 'production';
  if (lower === 'preview' || lower === 'staging' || lower === 'prerelease') return 'preview';
  if (lower === 'development' || lower === 'dev') return 'development';
  return 'unknown';
}

export function getRuntimeUpdateInfo(): RuntimeUpdateInfo {
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';
  const nativeBuildVersion =
    (Constants.expoConfig as unknown as { ios?: { buildNumber?: string } })?.ios?.buildNumber ??
    (Constants.expoConfig as unknown as { android?: { versionCode?: number | string } })?.android
      ?.versionCode?.toString() ??
    Constants.nativeBuildVersion ??
    null;

  const runtimeVersion = nativeBuildVersion ? `${appVersion} (${nativeBuildVersion})` : appVersion;

  let updateId: string | null = null;
  let createdAt: string | null = null;
  let channel: UpdateChannel = 'unknown';
  let isEmbedded = true;

  try {
    const manifest = Constants.expoConfig as unknown as {
      extra?: {
        expoClient?: {
          updateId?: string;
          releaseChannel?: string;
          channel?: string;
          createdAt?: string;
        };
        updateId?: string;
        releaseChannel?: string;
        channel?: string;
        expoUpdates?: {
          updateId?: string;
          createdAt?: string;
          channel?: string;
          releaseChannel?: string;
        };
      };
      releaseChannel?: string;
    } | null;

    const extra = manifest?.extra;
    const expoClient = extra?.expoClient;
    const expoUpdates = extra?.expoUpdates;

    const rawUpdateId =
      expoClient?.updateId ??
      expoUpdates?.updateId ??
      extra?.updateId ??
      null;

    const rawCreatedAt =
      expoClient?.createdAt ??
      expoUpdates?.createdAt ??
      null;

    const rawChannel =
      expoClient?.channel ??
      expoClient?.releaseChannel ??
      expoUpdates?.channel ??
      expoUpdates?.releaseChannel ??
      extra?.channel ??
      extra?.releaseChannel ??
      manifest?.releaseChannel ??
      null;

    if (typeof rawUpdateId === 'string' && rawUpdateId.trim().length > 0) {
      updateId = rawUpdateId;
      isEmbedded = false;
    }
    if (typeof rawCreatedAt === 'string' && rawCreatedAt.trim().length > 0) {
      createdAt = rawCreatedAt;
    }
    channel = safeExtractChannel(rawChannel);
  } catch (error) {
    console.warn('Unable to resolve update metadata from manifest:', error);
  }

  try {
    const Updates = requireExpoUpdates();
    if (Updates) {
      const channelFromUpdates =
        typeof Updates.channel === 'string' ? Updates.channel : null;
      const updateIdFromUpdates =
        typeof Updates.updateId === 'string' ? Updates.updateId : null;
      const createdAtFromUpdates =
        typeof Updates.createdAt === 'string' ? Updates.createdAt : null;
      const isEmbeddedFromUpdates =
        typeof Updates.isEmbeddedLaunch === 'boolean'
          ? Updates.isEmbeddedLaunch
          : typeof Updates.isEmbeddedLaunch === 'undefined'
            ? true
            : Updates.isEmbeddedLaunch;

      if (channelFromUpdates && channel === 'unknown') {
        channel = safeExtractChannel(channelFromUpdates);
      }
      if (updateIdFromUpdates && !updateId) {
        updateId = updateIdFromUpdates;
        isEmbedded = isEmbeddedFromUpdates;
      }
      if (createdAtFromUpdates && !createdAt) {
        createdAt = createdAtFromUpdates;
      }
    }
  } catch (error) {
    // Graceful degrade: expo-updates may not be installed in dev client
  }

  return {
    runtimeVersion,
    updateId,
    channel,
    createdAt,
    isEmbedded,
  };
}

function requireExpoUpdates(): unknown | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Updates = require('expo-updates');
    return Updates ?? null;
  } catch {
    return null;
  }
}

export async function checkForRuntimeUpdate(): Promise<UpdateCheckResult> {
  const Updates = requireExpoUpdates();
  if (!Updates || typeof Updates.checkForUpdateAsync !== 'function') {
    return {
      status: 'unsupported',
      message: 'OTA updates are unavailable in this build variant.',
      newUpdateId: null,
      createdAt: null,
    };
  }

  try {
    const checkResult = await (Updates.checkForUpdateAsync as () => Promise<unknown>)();
    if (!checkResult || typeof checkResult !== 'object') {
      return {
        status: 'error',
        message: 'Update check returned an unexpected response.',
        newUpdateId: null,
        createdAt: null,
      };
    }

    const cast = checkResult as {
      isAvailable?: boolean;
      isRollBackToEmbedded?: boolean;
      manifest?: {
        id?: string;
        updateId?: string;
        createdAt?: string;
        runtimeVersion?: string;
      } | null;
    };

    if (cast.isRollBackToEmbedded) {
      return {
        status: 'roll-back-available',
        message: 'A rollback to the embedded build is available.',
        newUpdateId:
          (cast.manifest?.id as string) ??
          (cast.manifest?.updateId as string) ??
          'embedded-rollback',
        createdAt: (cast.manifest?.createdAt as string) ?? null,
      };
    }

    if (cast.isAvailable) {
      return {
        status: 'available',
        message: 'A new update is available.',
        newUpdateId:
          (cast.manifest?.updateId as string) ??
          (cast.manifest?.id as string) ??
          null,
        createdAt: (cast.manifest?.createdAt as string) ?? null,
      };
    }

    return {
      status: 'up-to-date',
      message: 'You are running the latest available update.',
      newUpdateId: (cast.manifest?.updateId as string) ?? null,
      createdAt: (cast.manifest?.createdAt as string) ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Update check failed.';
    return {
      status: 'error',
      message,
      newUpdateId: null,
      createdAt: null,
    };
  }
}

const BASE64_TOKEN_RE =
  /(?:^|[\s:"'=,;({\[\]\n\r])(eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})(?:$|[\s"'=,;)}\]\n\r])/g;

const STELLAR_ADDRESS_RE = /\bG[A-Z2-7]{55}\b/g;
const MUXED_STELLAR_ADDRESS_RE = /\bM[A-Z2-7]{68}\b/g;
const CONTRACT_ADDRESS_RE = /\bC[A-Z2-7]{55}\b/g;

const HEADER_TOKEN_RE =
  /(authorization|x-api-key|x-auth-token|auth-token|bearer)\s*[:=]\s*["']?[A-Za-z0-9\-_.=+/]{8,}["']?/gi;

const AUTH_COOKIE_RE =
  /(auth-token|refresh-token|session|jwt)\s*[=:]\s*[A-Za-z0-9\-_.=+/]{8,}/gi;

export function redactSensitiveDiagnostics(raw: string): string {
  if (!raw) return '';

  let scrubbed = raw;

  scrubbed = scrubbed.replace(STELLAR_ADDRESS_RE, '[REDACTED_STELLAR_ADDRESS]');
  scrubbed = scrubbed.replace(MUXED_STELLAR_ADDRESS_RE, '[REDACTED_STELLAR_MUXED_ADDRESS]');
  scrubbed = scrubbed.replace(CONTRACT_ADDRESS_RE, '[REDACTED_CONTRACT_ADDRESS]');
  scrubbed = scrubbed.replace(BASE64_TOKEN_RE, (match) =>
    match.replace(/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/, '[REDACTED_JWT]'),
  );

  scrubbed = scrubbed.replace(HEADER_TOKEN_RE, (_, headerName) => `${headerName}: [REDACTED_TOKEN]`);
  scrubbed = scrubbed.replace(AUTH_COOKIE_RE, (_, cookieName) => `${cookieName}=[REDACTED_COOKIE]`);

  return scrubbed;
}

export function buildDiagnosticsBlock(ctx: DiagnosticsContext): string {
  const runtime = getRuntimeUpdateInfo();
  const platform = `${Platform.OS} ${Platform.Version ?? ''}`.trim();
  const now = new Date().toISOString();

  const lines: Array<[string, string]> = [];

  lines.push(['Generated at', now]);
  lines.push(['App', Constants.expoConfig?.name ?? 'Lumenpulse']);
  lines.push(['Runtime Version', runtime.runtimeVersion]);
  lines.push(['Platform', platform]);

  if (runtime.updateId) {
    lines.push(['Update ID', runtime.updateId]);
  } else {
    lines.push(['Update ID', runtime.isEmbedded ? '(embedded build)' : '(unknown)']);
  }

  lines.push(['Update Channel', runtime.channel]);

  if (runtime.createdAt) {
    lines.push(['Update Created', runtime.createdAt]);
  }

  lines.push(['Build Type', runtime.isEmbedded ? 'Embedded (no OTA applied)' : 'OTA Update Applied']);

  lines.push(['Environment', `${ctx.environmentLabel} (${ctx.environment})`]);
  lines.push(['Stellar Network', ctx.stellarNetwork ?? '(not configured)']);
  lines.push(['API Base URL', ctx.apiBaseUrl ?? '(not configured)']);
  lines.push(['Soroban RPC', ctx.sorobanRpcUrl ?? '(not configured)']);

  if (ctx.crowdfundContractId) {
    lines.push(['Crowdfund Contract', ctx.crowdfundContractId]);
  }

  if (ctx.connectionStatus) {
    lines.push(['Connection Status', ctx.connectionStatus]);
  }
  if (ctx.lastCheckedAt) {
    lines.push(['Last Network Check', ctx.lastCheckedAt]);
  }

  const widestLabel = lines.reduce((max, [label]) => Math.max(max, label.length), 0);
  const body = lines
    .map(([label, value]) => `${label.padEnd(widestLabel, ' ')} : ${value}`)
    .join('\n');

  const raw = `--- Lumenpulse Diagnostics ---\n${body}\n--- END Diagnostics ---`;

  return redactSensitiveDiagnostics(raw);
}
