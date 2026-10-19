import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { SupportSession } from './entities/support-session.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import {
  NotificationSeverity,
  NotificationType,
} from '../notification/notification.entity';

/** Fixed lifetime of a support session. It can never be extended. */
export const SUPPORT_SESSION_TTL_MS = 15 * 60 * 1000;
/** Upper bound on recorded endpoint accesses per session. */
export const SUPPORT_MAX_RECORDED_ENDPOINTS = 1000;

export interface SupportSessionSummary {
  id: string;
  actorId: string;
  subjectId: string;
  reason: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  active: boolean;
  durationMs: number;
  endpoints: SupportSession['endpoints'];
}

@Injectable()
export class SupportModeService {
  private readonly logger = new Logger(SupportModeService.name);

  constructor(
    @InjectRepository(SupportSession)
    private readonly sessions: Repository<SupportSession>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Start a read-only session as `subjectId`. Returns a short-lived access
   * token whose `exp` equals the session expiry.
   */
  async start(
    actor: { id: string },
    subjectId: string,
    reason: string,
    ipAddress?: string,
  ): Promise<{
    accessToken: string;
    session: SupportSessionSummary;
  }> {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 10) {
      throw new BadRequestException(
        'A reason of at least 10 characters is required',
      );
    }
    if (subjectId === actor.id) {
      throw new BadRequestException(
        'Cannot open a support session on yourself',
      );
    }

    const subject = await this.users.findOne({ where: { id: subjectId } });
    if (!subject || subject.deletedAt) {
      throw new NotFoundException('User not found');
    }
    if (subject.role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Support sessions cannot be opened on administrator accounts',
      );
    }

    const expiresAt = new Date(Date.now() + SUPPORT_SESSION_TTL_MS);
    const session = await this.sessions.save(
      this.sessions.create({
        actorId: actor.id,
        subjectId,
        reason: trimmed.slice(0, 500),
        ipAddress: ipAddress ?? null,
        expiresAt,
        endedAt: null,
        endpoints: [],
      }),
    );

    // Role is pinned to USER: a support token never carries elevated rights.
    const accessToken = this.jwtService.sign(
      {
        sub: subjectId,
        role: UserRole.USER,
        type: 'support',
        supportSessionId: session.id,
        actorId: actor.id,
      },
      { expiresIn: Math.floor(SUPPORT_SESSION_TTL_MS / 1000) },
    );

    await this.auditService.log(
      'support_session_start',
      actor.id,
      ipAddress ?? null,
      {
        supportSessionId: session.id,
        subjectId,
        reason: session.reason,
        expiresAt: expiresAt.toISOString(),
      },
    );

    await this.notificationService.create({
      type: NotificationType.ADMIN,
      severity: NotificationSeverity.HIGH,
      title: 'Your account was accessed by support',
      message:
        'A Lumenpulse administrator opened a read-only support session on your account to investigate a report. No changes were made.',
      userId: subjectId,
      metadata: {
        supportSessionId: session.id,
        startedAt: session.startedAt,
        expiresAt,
      },
    });

    this.logger.warn(
      `Support session ${session.id}: actor ${actor.id} -> subject ${subjectId}`,
    );

    return { accessToken, session: this.summarise(session) };
  }

  async end(
    sessionId: string,
    actorId: string,
    ipAddress?: string,
  ): Promise<SupportSessionSummary> {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session || session.actorId !== actorId) {
      throw new NotFoundException('Support session not found');
    }
    if (!session.endedAt) {
      session.endedAt = new Date();
      await this.sessions.save(session);
      await this.auditService.log(
        'support_session_end',
        actorId,
        ipAddress ?? null,
        {
          supportSessionId: session.id,
          subjectId: session.subjectId,
          endpointCount: session.endpoints.length,
        },
      );
    }
    return this.summarise(session);
  }

  /** Returns the session only while it may still be used, else null. */
  async findActive(sessionId: string): Promise<SupportSession | null> {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session || session.endedAt || session.expiresAt <= new Date()) {
      return null;
    }
    return session;
  }

  /** Append one endpoint access atomically (capped). */
  async recordAccess(
    sessionId: string,
    method: string,
    path: string,
  ): Promise<void> {
    const entry = JSON.stringify([
      { method, path: path.slice(0, 300), at: new Date().toISOString() },
    ]);
    await this.sessions.query(
      `UPDATE "support_sessions"
          SET "endpoints" = "endpoints" || $1::jsonb
        WHERE "id" = $2 AND jsonb_array_length("endpoints") < $3`,
      [entry, sessionId, SUPPORT_MAX_RECORDED_ENDPOINTS],
    );
  }

  async get(sessionId: string): Promise<SupportSessionSummary> {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Support session not found');
    return this.summarise(session);
  }

  async list(
    filter: { actorId?: string; subjectId?: string } = {},
    limit = 50,
  ): Promise<SupportSessionSummary[]> {
    const rows = await this.sessions.find({
      where: {
        ...(filter.actorId ? { actorId: filter.actorId } : {}),
        ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
      },
      order: { startedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((row) => this.summarise(row));
  }

  private summarise(session: SupportSession): SupportSessionSummary {
    const now = Date.now();
    const stop = Math.min(
      session.endedAt?.getTime() ?? now,
      session.expiresAt.getTime(),
      now,
    );
    return {
      id: session.id,
      actorId: session.actorId,
      subjectId: session.subjectId,
      reason: session.reason,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      endedAt: session.endedAt,
      active: !session.endedAt && session.expiresAt.getTime() > now,
      durationMs: Math.max(0, stop - session.startedAt.getTime()),
      endpoints: session.endpoints ?? [],
    };
  }
}
