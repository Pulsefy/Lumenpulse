import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { config } from '../lib/config';
import {
  ROTATABLE_SECRET_NAMES,
  RotatableSecretName,
  RotatableSecretStatus,
  RotateSecretOptions,
  SecretRotationResult,
} from './secret-rotation.types';

/** A single value a secret has held, kept for the overlap window. */
interface SecretVersion {
  id: string;
  value: string;
  createdAt: number;
  /** Epoch ms after which the value must be rejected again. Null = active. */
  expiresAt: number | null;
}

interface SecretEntry {
  active: SecretVersion | null;
  previous: SecretVersion[];
  version: number;
}

/** Upper bound for a single overlap window (30 days). */
export const MAX_SECRET_ROTATION_OVERLAP_MS = 30 * 24 * 60 * 60 * 1000;

/** Guards against a mis-typed multi-megabyte secret. */
export const MAX_SECRET_LENGTH = 4_096;

/**
 * Where each rotatable secret's boot value comes from. Reading through a
 * getter keeps the store seeded from the frozen global `config` object
 * without copying every secret at module load.
 */
const SECRET_SOURCES: Record<
  RotatableSecretName,
  () => string | null | undefined
> = {
  CONTRACT_ADMIN_API_KEY: () => config.apiKeys.contractAdmin,
  WEBHOOK_SECRET: () => config.apiKeys.webhookSecret,
  SOROBAN_INGEST_SECRET: () => config.soroban.ingestSecret,
  DRIFT_ALERT_INGEST_SECRET: () => config.driftAlerts.ingestSecret,
  PYTHON_API_KEY: () => config.python.apiKey,
};

const rotateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  value: z.string().min(1).max(MAX_SECRET_LENGTH),
  actor: z.string().min(1).max(200),
  reason: z.string().max(500).optional(),
  overlapMs: z
    .number()
    .int()
    .min(0)
    .max(MAX_SECRET_ROTATION_OVERLAP_MS)
    .optional(),
});

export interface ParsedRotationRequest {
  name: string;
  value: string;
  actor: string;
  reason?: string;
  overlapMs?: number;
}

/**
 * Runtime store for rotatable secrets.
 *
 * `apps/backend/src/lib/config.ts` validates the environment once at boot and
 * freezes the result, so a rotated secret is normally invisible until the
 * process restarts. This service keeps a small in-memory version history per
 * secret and lets a rotation take effect immediately:
 *
 * - the new value becomes active for everything that reads it afterwards;
 * - the previous value keeps verifying for a configurable overlap window, so
 *   requests already in flight (or signed with the old value) are unaffected;
 * - every swap is audited with the acting identity and a timestamp — never
 *   with the value itself.
 *
 * The store is deliberately not backed by `process.env`: mutating the
 * environment would be visible to unrelated code, and the frozen `config`
 * contract would no longer describe what is running. Consumers opt in by
 * calling {@link verify} / {@link acceptableValues} instead of reading a
 * single static value.
 */
@Injectable()
export class SecretRotationService {
  private readonly logger = new Logger(SecretRotationService.name);
  private readonly entries = new Map<RotatableSecretName, SecretEntry>();
  private readonly defaultOverlapMs = config.secretRotation.overlapMs;

  constructor(private readonly auditService: AuditService) {
    for (const name of ROTATABLE_SECRET_NAMES) {
      const value = SECRET_SOURCES[name]();
      if (typeof value === 'string' && value.trim().length > 0) {
        this.entries.set(name, {
          active: this.createVersion(value, null),
          previous: [],
          version: 1,
        });
      }
    }
  }

  isRotatableSecretName(name: string): name is RotatableSecretName {
    return (ROTATABLE_SECRET_NAMES as readonly string[]).includes(name);
  }

  /**
   * Current value for a secret, or null when it was never configured.
   * Prefer {@link verify} when checking a caller-supplied value.
   */
  reveal(name: string): string | null {
    return this.findEntry(name)?.active?.value ?? null;
  }

  /**
   * Every value that is still acceptable for the secret: the active one plus
   * any previous value whose overlap window has not elapsed yet.
   */
  acceptableValues(name: string): string[] {
    const entry = this.findEntry(name);
    if (!entry) {
      return [];
    }

    const now = Date.now();
    const values: string[] = [];
    if (entry.active) {
      values.push(entry.active.value);
    }
    for (const version of this.livePrevious(entry, now)) {
      values.push(version.value);
    }

    return [...new Set(values)];
  }

  /** Constant-time comparison against every acceptable value. */
  verify(name: string, candidate: string): boolean {
    if (!candidate) {
      return false;
    }

    return this.acceptableValues(name).some((value) =>
      constantTimeEquals(candidate, value),
    );
  }

  /** Non-sensitive rotation state for every rotatable secret. */
  getStatus(): RotatableSecretStatus[] {
    const now = Date.now();

    return ROTATABLE_SECRET_NAMES.map((name) => {
      const entry = this.entries.get(name);
      const previous = entry ? this.livePrevious(entry, now) : [];
      const active = entry?.active ?? null;

      return {
        name,
        configured: active !== null,
        version: entry?.version ?? 0,
        activeSecretId: active?.id ?? null,
        activeSince: active ? new Date(active.createdAt).toISOString() : null,
        overlapExpiresAt: previous[0]?.expiresAt
          ? new Date(previous[0].expiresAt).toISOString()
          : null,
        previousSecretIds: previous.map((version) => version.id),
      };
    });
  }

  /** Validate an untrusted rotation payload. */
  parseRotationRequest(input: unknown): ParsedRotationRequest {
    const result = rotateRequestSchema.safeParse(input);
    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; ');
      throw new BadRequestException(
        `Invalid secret rotation request: ${details}`,
      );
    }

    return result.data;
  }

  /**
   * Apply a rotation: the new value becomes active and the previous value is
   * kept until `overlapMs` elapses. The swap is in-memory and synchronous, so
   * an in-flight request that already resolved the old value keeps working.
   *
   * If the audit write fails the swap is rolled back, so an unlogged rotation
   * can never happen.
   */
  async rotate(
    name: string,
    newValue: string,
    options: RotateSecretOptions,
  ): Promise<SecretRotationResult> {
    const secretName = this.assertRotatable(name);
    const overlapMs = this.resolveOverlap(options.overlapMs);
    this.assertValue(newValue);
    this.assertActor(options.actor);

    const now = Date.now();
    const previousEntry = this.entries.get(secretName);
    const livePrevious = previousEntry
      ? this.livePrevious(previousEntry, now)
      : [];

    const previous: SecretVersion[] = [];
    if (previousEntry?.active) {
      previous.push({
        ...previousEntry.active,
        expiresAt: overlapMs > 0 ? now + overlapMs : now,
      });
    }
    previous.push(...livePrevious);

    const version = (previousEntry?.version ?? 0) + 1;
    const active = this.createVersion(newValue, null);
    this.entries.set(secretName, { active, previous, version });

    try {
      // Audit identifiers and the overlap, never the value.
      const auditLog = await this.auditService.log(
        'secrets.rotate',
        options.actor,
        options.ipAddress ?? null,
        {
          secretName,
          version,
          activeSecretId: active.id,
          previousSecretIds: previous.map((entry) => entry.id),
          overlapMs,
          reason: options.reason ?? null,
        },
      );

      this.logger.log(
        `Rotated ${secretName} to version ${version} ` +
          `(overlap ${overlapMs}ms, actor ${options.actor})`,
      );

      return {
        name: secretName,
        version,
        secretId: active.id,
        previousSecretIds: previous.map((entry) => entry.id),
        overlapExpiresAt: previous[0]?.expiresAt
          ? new Date(previous[0].expiresAt).toISOString()
          : null,
        rotatedAt: new Date(now).toISOString(),
        auditLogId: auditLog.id,
      };
    } catch (error) {
      if (previousEntry) {
        this.entries.set(secretName, previousEntry);
      } else {
        this.entries.delete(secretName);
      }
      throw error;
    }
  }

  private findEntry(name: string): SecretEntry | undefined {
    return this.isRotatableSecretName(name)
      ? this.entries.get(name)
      : undefined;
  }

  private assertRotatable(name: string): RotatableSecretName {
    if (!this.isRotatableSecretName(name)) {
      throw new BadRequestException(
        `Secret "${name}" is not rotatable. Supported: ${ROTATABLE_SECRET_NAMES.join(', ')}`,
      );
    }
    return name;
  }

  private assertValue(value: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException('The new secret value must not be empty.');
    }
    if (value.length > MAX_SECRET_LENGTH) {
      throw new BadRequestException(
        `The new secret value must be at most ${MAX_SECRET_LENGTH} characters.`,
      );
    }
  }

  private assertActor(actor: string): void {
    if (typeof actor !== 'string' || actor.trim().length === 0) {
      throw new BadRequestException(
        'An actor is required so the rotation can be audited.',
      );
    }
  }

  private resolveOverlap(overlapMs: number | undefined): number {
    const value = overlapMs ?? this.defaultOverlapMs;
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > MAX_SECRET_ROTATION_OVERLAP_MS
    ) {
      throw new BadRequestException(
        `overlapMs must be an integer between 0 and ${MAX_SECRET_ROTATION_OVERLAP_MS}.`,
      );
    }
    return value;
  }

  private livePrevious(entry: SecretEntry, now: number): SecretVersion[] {
    return entry.previous.filter(
      (version) => version.expiresAt === null || version.expiresAt > now,
    );
  }

  private createVersion(value: string, expiresAt: number | null): SecretVersion {
    return { id: randomUUID(), value, createdAt: Date.now(), expiresAt };
  }
}

/** Hash-then-compare keeps the comparison constant-time for any input length. */
function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
