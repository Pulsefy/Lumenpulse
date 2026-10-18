/* eslint-disable @typescript-eslint/no-unsafe-enum-comparison */
import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';
import { User } from '../users/entities/user.entity';
import {
  SupportSession,
  SupportSessionStatus,
} from './entities/support-session.entity';

export interface StartSupportSessionInput {
  actorId: string;
  subjectId: string;
  reason?: string;
  durationMinutes?: number;
}

export interface StartedSupportSession {
  session: SupportSession;
  token: string;
}

export interface ResolvedSupportSession {
  session: SupportSession;
}

@Injectable()
export class SupportAccessService {
  private readonly logger = new Logger(SupportAccessService.name);
  private readonly defaultDurationMinutes: number;
  private readonly maxDurationMinutes: number;

  constructor(
    @InjectRepository(SupportSession)
    private readonly sessionRepository: Repository<SupportSession>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {
    this.defaultDurationMinutes = Number(this.configService.get<string>('SUPPORT_SESSION_DEFAULT_MINUTES') ?? '30');
    this.maxDurationMinutes = Number(this.configService.get<string>('SUPPORT_SESSION_MAX_MICUTES') ?? '60');
  }

  /**
   * Start a new read-only support session.
   * Returns the session and a one-time token to be used by the admin.
   */
  async startSession(
    input: StartSupportSessionInput,
  ): Promise<StartedSupportSession> {
    const { actorId, subjectId, reason } = input;

    if (actorId === subjectId) {
      throw new BadGatewayException('Actor and subject must be different');
    }

    const subject = await this.userRepository.findOne({ where: { id: subjectId } });
    if (!subject) {
      throw new NotFoundException('Subject user not found');
    }

    const active = await this.sessionRepository.findOne({
      where: { actorId, status: SupportSessionStatus.ACTIVE },
    });
    if (active) {
      throw new ConflictException(
        'An active support session already exists for this actor',
      );
    }

    const requested = input.durationMinutes ?? this.defaultDurationMinutes;
    const duration = Math.min(Math.max(requested, 1), this.maxDurationMinutes);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + duration * 60_000);

    const session = this.sessionRepository.create({
      actorId,
      subjectId,
      reason,
      startedAt: now,
      expiresAt: expiresAt,
      endpoints: [],
      endpointCount: 0,
      status: SupportSessionStatus.ACTIVE,
    });

    const saved = await this.sessionRepository.save(session);

    // One-time token for the admin to activate support mode.
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Persist the hash on the session row for validation.
    await this.sessionRepository.update(saved.id, {
      // tokenHash is stored in a separate column in the migration
      // (added below); we use a type assertion to keep the entity clean.
      ...({ tokenHash } as Record<string, unknown>),
    } as any);

    this.logger.log(
      `Started support session ${saved.id} by actor ${actorId} for subject ${subjectId} expires at ${expiresAt.toISOString()}`,
    );

    return { session: saved, token };
  }

  /**
   * Resolve an active session from a token. Throws if expired or ended.
   */
  async resolveSession(
    token: string,
  ): Promise<ResolvedSupportSession> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = await this.sessionRepository.findOne({
      where: { tokenHash } as any,
    });

    if (!session) {
      throw new NotFoundException('Support session not found');
    }

    if (session.status !== SupportSessionStatus.ACTIVE) {
      throw new ForbiddenException('Support session is not active');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessionRepository.update(session.id, {
        status: SupportSessionStatus.EXPIRED,
        endedAt: new Date(),
      });
      throw new ForbiddenException('Support session has expired');
    }

    return { session };
  }

  /**
   * Record an endpoint accessed during a support session.
   */
  async recordEndpointAccess(
    sessionId: string,
    method: string,
    path: string,
  ): Promise<void> {
    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });
    if (!session) {
      return;
    }

    const entry = {
      method,
      path,
      timestamp: new Date().toISOString(),
    };

    const endpoints = [...(session.endpoints ?? []), entry];
    await this.sessionRepository.update(session.id, {
      endpoints,
      endpointCount: endpoints.length,
    });
  }

  /**
   * End a support session explicitly.
   */
  async endSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('Support session not found');
    }
    if (session.status === SupportSessionStatus.ENDED) {
      return;
    }
    await this.sessionRepository.update(session.id, {
      status: SupportSessionStatus.ENDED,
      endedAt: new Date(),
    });
  }

  /**
   * Expire any suspended sessions whose expiry has passed.
   * Called by a cron job and on request resolution.
   */
  async expireStaleSessions(): Promise<number> {
    const result = await this.sessionRepository
      .createQueryBuilder()
      .update(SupportSession)
      .set({ status: SupportSessionStatus.EXPIRED, endedAt: () => 'NOW()' })
      .where('status = :active', { active: SupportSessionStatus.ACTIVE })
      .andWhere('expiresAt <= NOW()')
      .execute();
    return result.affected ?? 0;
  }

  /**
   * List sessions for audit/support tooling.
   */
  async listSessions(forAdminId?: string): Promise<SupportSession[]> {
    const where = forAdminId ? { actorId: forAdminId } : {};
    return this.sessionRepository.find({
      where,
      order: { startedAt: 'DESC' },
    });
  }
}
