import { Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';

export interface Diagnostics {
  releaseIdentifier: string;
  environment: string;
  appVersion: string;
  buildNumber?: string;
  platform: string;
  os: string;
  deviceModel?: string;
  locale?: string;
  timestamp: string;
  recentErrors: RecentErrorEntry[];
}

export interface RecentErrorEntry {
  message: string;
  code?: string;
  at: string;
}

const MAX_RECENT_ERRORS = 10;
const MAX_ERROR_LENGTH = 300;

const recentErrors: RecentErrorEntry[] = [];

/**
 * Patterns that must never leave the device in diagnostics.
 * Wallet addresses (Stellar Edwards-checksum base32 G 4 ... and S ...) tokens,
 * secret keys (S...) and long hex strings are redacted.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // Stellar public account (56 chars, G) and secret seed (S) addresses
  /\b[GS][A-Z2-7]{55}\b/g,
  // Base64 secret keys / tokens (32+ chars)
  /[A-Za-z0-9+/]{32,}=*/g,
  // Hex strings of 32+ bytes
  /\b[0-9a-f]{32,}\b/gi,
  // JWTs (header.payload.signature)
  /\b([\w-]+\.){2}[\w-]+\b/g,
];

function redactSensitive(value: string): string {
  let result = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

export function recordError(error: unknown, code?: string): void {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';
  recentErrors.unshift({
    message: redactSensitive(message).slice(0, MAX_ERROR_LENGTH),
    code,
    at: new Date().toISOString(),
  });
  if (recentErrors.length > MAX_RECENT_ERRORS) {
    recentErrors.length = MAX_RECENT_ERRORS;
  }
}

export function getRecentErrors(): RecentErrorEntry[] {
  return recentErrors.map((e) => ({ ...e }));
}

export function clearRecentErrors(): void {
  recentErrors.length = 0;
}

function resolveEnvironment(): string {
  const expoConfig = Constants.expoConfig as unknown as {
    extra?: { env?: string };
  } | undefined;
  return (
    expoConfig?.extra?.env ??
    process.env.APP_ENV ??
    process.env.NODE_ENV ??
    'development'
  );
}

function resolveReleaseIdentifier(): string {
  const expoConfig = Constants.expoConfig as unknown as {
    extra?: { release?: string; releaseId?: string };
  } | undefined;
  return (
    expoConfig?.extra?.releaseId ??
    expoConfig?.extra?.release ??
    Application.nativeApplicationVersion ??
    'unknown'
  );
}

export function getDiagnostics(): Diagnostics {
  return {
    releaseIdentifier: resolveReleaseIdentifier(),
    environment: resolveEnvironment(),
    appVersion: Application.nativeApplicationVersion ?? 'unknown',
    buildNumber: Application.nativeBuildVersion,
    platform: Platform.OS,
    os: `${Platform.OS} ${Platform.Version}`,
    deviceModel: undefined,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timestamp: new Date().toISOString(),
    recentErrors: getRecentErrors(),
  };
}

/**
 * Builds a human-readable preview of exactly what will be attached to a
 * feedback submission. The same object is what gets serialized and sent.
 */
export function getDiagnosticsPreview(): string {
  const d = getDiagnostics();
  const lines = [
    `Release: ${d.releaseIdentifier}`,
    `Environment: ${d.environment}`,
    `App version: ${d.appVersion}`,
  ];
  if (d.buildNumber) lines.push(`Build: ${d.buildNumber}`);
  lines.push(`Platform: ${d.platform}`, `OS: ${d.os}`);
  if (d.locale) lines.push(`Locale: ${d.locale}`);
  lines.push(`Timestamp: ${d.timestamp}`);
  if (d.recentErrors.length > 0) {
    lines.push('Recent errors:');
    for (let e = 0; e < d.recentErrors.length; e++) {
      const entry = d.recentErrors[e];
      lines.push(`  ${entry.at} ${entry.code ? `[${entry.code}] ` : ''}${entry.message}`);
    }
  } else {
    lines.push('Recent errors: none');
  }
  return lines.join('\n');
}
