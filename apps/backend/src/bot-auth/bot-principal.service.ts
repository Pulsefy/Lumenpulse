import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { config } from '../lib/config';

export type BotPrincipalType = 'bot' | 'service';

export interface BotPrincipal {
  type: BotPrincipalType;
  /** Configured principal identifier (e.g. `telegram-bot`, `data-processing`). */
  id: string;
}

export interface BotPrincipalCredentials {
  /** Comma-separated `botId:token` pairs. */
  botTokens?: string;
  /** Comma-separated `serviceId:token` pairs. */
  serviceTokens?: string;
}

/** Optional DI token to supply credentials explicitly (mainly for tests). */
export const BOT_PRINCIPAL_CREDENTIALS = Symbol('BOT_PRINCIPAL_CREDENTIALS');

/** Header carrying a bot credential. */
export const BOT_TOKEN_HEADER = 'x-bot-token';
/** Header carrying a service credential. */
export const SERVICE_TOKEN_HEADER = 'x-service-token';

/** JWT `type` claim values that identify machine principals. */
const MACHINE_JWT_TYPES: ReadonlySet<string> = new Set(['bot', 'service']);

interface CredentialEntry {
  id: string;
  digest: Buffer;
}

type HeaderBag = Record<string, string | string[] | undefined>;

/**
 * Authenticates bot and service (machine) principals.
 *
 * Machine principals present a shared-secret token in `X-Bot-Token` or
 * `X-Service-Token`. Tokens are configured through `BOT_AUTH_BOT_TOKENS` and
 * `BOT_AUTH_SERVICE_TOKENS` as comma-separated `principalId:token` pairs.
 * Signed JWTs whose `type` claim is `bot` or `service` are also recognised.
 *
 * The service is deliberately dependency-free so it can be used both by
 * bot-auth consumers and by the global rate-limit guard.
 */
@Injectable()
export class BotPrincipalService {
  private readonly botCredentials: CredentialEntry[];
  private readonly serviceCredentials: CredentialEntry[];

  constructor(
    @Optional()
    @Inject(BOT_PRINCIPAL_CREDENTIALS)
    credentials?: BotPrincipalCredentials,
  ) {
    const source: BotPrincipalCredentials = credentials ?? {
      botTokens: config.botAuth?.botTokens,
      serviceTokens: config.botAuth?.serviceTokens,
    };

    this.botCredentials = BotPrincipalService.parseCredentials(
      source.botTokens,
    );
    this.serviceCredentials = BotPrincipalService.parseCredentials(
      source.serviceTokens,
    );
  }

  /** True when at least one bot or service credential is configured. */
  get isConfigured(): boolean {
    return this.botCredentials.length > 0 || this.serviceCredentials.length > 0;
  }

  /**
   * Authenticates a machine principal from request headers.
   * Returns `null` when no valid bot / service credential is present.
   */
  authenticateHeaders(headers: HeaderBag | undefined): BotPrincipal | null {
    if (!headers || !this.isConfigured) {
      return null;
    }

    const serviceToken = BotPrincipalService.readHeader(
      headers,
      SERVICE_TOKEN_HEADER,
    );
    if (serviceToken) {
      const id = this.match(serviceToken, this.serviceCredentials);
      if (id) {
        return { type: 'service', id };
      }
    }

    const botToken = BotPrincipalService.readHeader(headers, BOT_TOKEN_HEADER);
    if (botToken) {
      const id = this.match(botToken, this.botCredentials);
      if (id) {
        return { type: 'bot', id };
      }
    }

    return null;
  }

  /**
   * Classifies an already-verified JWT payload. Returns a machine principal
   * when the token's `type` claim is `bot` or `service`, otherwise `null`.
   */
  fromVerifiedJwtPayload(
    payload: Record<string, unknown> | null | undefined,
  ): BotPrincipal | null {
    if (!payload) {
      return null;
    }

    const type =
      typeof payload.type === 'string' ? payload.type.toLowerCase() : '';
    const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';

    if (!MACHINE_JWT_TYPES.has(type) || !sub) {
      return null;
    }

    return { type: type as BotPrincipalType, id: sub };
  }

  private match(token: string, entries: CredentialEntry[]): string | null {
    const digest = BotPrincipalService.digest(token);
    let matchedId: string | null = null;

    // Compare against every entry in constant time to avoid leaking which
    // (or whether any) credential matched through timing.
    for (const entry of entries) {
      if (timingSafeEqual(digest, entry.digest) && matchedId === null) {
        matchedId = entry.id;
      }
    }

    return matchedId;
  }

  private static parseCredentials(raw: string | undefined): CredentialEntry[] {
    if (!raw) {
      return [];
    }

    return raw
      .split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const separator = pair.indexOf(':');
        if (separator <= 0 || separator === pair.length - 1) {
          return null;
        }
        const id = pair.slice(0, separator).trim();
        const token = pair.slice(separator + 1).trim();
        if (!id || !token) {
          return null;
        }
        return { id, digest: BotPrincipalService.digest(token) };
      })
      .filter((entry): entry is CredentialEntry => entry !== null);
  }

  private static readHeader(headers: HeaderBag, name: string): string {
    const value = headers[name];
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' ? first.trim() : '';
  }

  private static digest(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest();
  }
}
