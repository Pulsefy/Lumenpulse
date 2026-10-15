import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BotPrincipalService } from '../../bot-auth/bot-principal.service';
import { config } from '../../lib/config';
import {
  RATE_LIMIT_PRINCIPAL_REQUEST_KEY,
  RateLimitPrincipal,
} from './rate-limit.constants';

/** Optional DI token to override the JWT secret (mainly for tests). */
export const RATE_LIMIT_JWT_SECRET = Symbol('RATE_LIMIT_JWT_SECRET');

type HeaderBag = Record<string, string | string[] | undefined>;

interface RequestLike {
  headers?: HeaderBag;
  ip?: string;
  user?: unknown;
  [RATE_LIMIT_PRINCIPAL_REQUEST_KEY]?: RateLimitPrincipal;
  [key: string]: unknown;
}

/**
 * Resolves the principal that a request should be rate limited as.
 *
 * Resolution order:
 *   1. A principal already attached to `req.user` (e.g. by upstream middleware).
 *   2. A bot / service principal authenticated through bot-auth
 *      (`X-Bot-Token` / `X-Service-Token`).
 *   3. A signed, unexpired Bearer JWT. Tokens whose `type` claim is `bot` or
 *      `service` are classified as machine principals via bot-auth; all
 *      others are treated as users.
 *   4. Otherwise the request is anonymous and falls back to its source
 *      address (see `getTrackerId`).
 *
 * The global rate-limit guard runs before route-level `JwtAuthGuard`, so
 * `req.user` is normally not populated yet — hence the local JWT
 * verification. Only cryptographically valid tokens are honoured, so a caller
 * cannot mint fresh budgets by sending forged or random tokens: those simply
 * fall back to source-address limiting.
 */
@Injectable()
export class RateLimitPrincipalResolver {
  private readonly logger = new Logger(RateLimitPrincipalResolver.name);
  private readonly jwtService: JwtService | null;
  private readonly botPrincipalService: BotPrincipalService;

  constructor(
    @Optional() botPrincipalService?: BotPrincipalService,
    @Optional() @Inject(RATE_LIMIT_JWT_SECRET) jwtSecret?: string,
  ) {
    this.botPrincipalService = botPrincipalService ?? new BotPrincipalService();

    const secret = jwtSecret ?? RateLimitPrincipalResolver.readJwtSecret();
    this.jwtService = secret ? new JwtService({ secret }) : null;
  }

  /**
   * Returns the resolved principal and caches it on the request so it is only
   * computed once per request.
   */
  resolve(request: RequestLike, anonymousTracker: string): RateLimitPrincipal {
    const cached = request[RATE_LIMIT_PRINCIPAL_REQUEST_KEY];
    if (cached) {
      return cached;
    }

    const principal =
      this.fromRequestUser(request.user) ??
      this.fromBotAuth(request.headers) ??
      this.fromBearerToken(request.headers) ??
      RateLimitPrincipalResolver.anonymous(anonymousTracker);

    request[RATE_LIMIT_PRINCIPAL_REQUEST_KEY] = principal;
    return principal;
  }

  private fromRequestUser(user: unknown): RateLimitPrincipal | null {
    if (!user || typeof user !== 'object') {
      return null;
    }

    const record = user as Record<string, unknown>;
    const principalType = record.principalType;
    const id = record.id ?? record.sub;

    if (typeof id !== 'string' && typeof id !== 'number') {
      return null;
    }

    const normalizedId = String(id);
    if (principalType === 'bot' || principalType === 'service') {
      return RateLimitPrincipalResolver.build(principalType, normalizedId);
    }

    return RateLimitPrincipalResolver.build('user', normalizedId);
  }

  private fromBotAuth(
    headers: HeaderBag | undefined,
  ): RateLimitPrincipal | null {
    const principal = this.botPrincipalService.authenticateHeaders(headers);
    return principal
      ? RateLimitPrincipalResolver.build(principal.type, principal.id)
      : null;
  }

  private fromBearerToken(
    headers: HeaderBag | undefined,
  ): RateLimitPrincipal | null {
    if (!this.jwtService || !headers) {
      return null;
    }

    const raw = headers.authorization;
    const authorization = Array.isArray(raw) ? raw[0] : raw;
    if (typeof authorization !== 'string') {
      return null;
    }

    const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
    if (!match) {
      return null;
    }

    let payload: Record<string, unknown>;
    try {
      payload = this.jwtService.verify<Record<string, unknown>>(match[1]);
    } catch {
      // Invalid / expired token: authentication itself is enforced by
      // JwtAuthGuard; here we just fall back to source-address limiting.
      return null;
    }

    const machine = this.botPrincipalService.fromVerifiedJwtPayload(payload);
    if (machine) {
      return RateLimitPrincipalResolver.build(machine.type, machine.id);
    }

    const sub = payload.sub;
    if (typeof sub !== 'string' && typeof sub !== 'number') {
      return null;
    }

    return RateLimitPrincipalResolver.build('user', String(sub));
  }

  private static build(
    type: 'user' | 'bot' | 'service',
    id: string,
  ): RateLimitPrincipal {
    return { type, id, trackerKey: `${type}:${id}` };
  }

  private static anonymous(tracker: string): RateLimitPrincipal {
    return { type: 'anonymous', id: tracker, trackerKey: tracker };
  }

  private static readJwtSecret(): string | undefined {
    try {
      const secret = config.auth?.jwtSecret;
      if (!secret) {
        return undefined;
      }
      return typeof secret === 'string' ? secret : secret.reveal();
    } catch {
      return undefined;
    }
  }
}
