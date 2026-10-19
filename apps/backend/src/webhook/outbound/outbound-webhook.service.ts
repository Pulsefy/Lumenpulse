import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Optional,
  Inject,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import {
  WebhookSubscription,
  WebhookSubscriptionStatus,
} from './entities/webhook-subscription.entity';
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
} from './entities/webhook-delivery.entity';
import {
  WebhookDeadLetter,
  WebhookDeadLetterStatus,
} from './entities/webhook-dead-letter.entity';
import {
  CreateWebhookSubscriptionDto,
  UpdateWebhookSubscriptionDto,
  RotateWebhookSecretDto,
} from './dto/webhook-subscription.dto';
import {
  QuerySubscriptionsDto,
  QueryDeliveriesDto,
  QueryDeadLetterDto,
  ResolveWebhookDeadLetterDto,
} from './dto/query-webhook.dto';
import { JobLockService } from '../../scheduler/job-lock.service';
import { AuditService } from '../../audit/audit.service';
import { MetricsService } from '../../metrics/metrics.service';
import { OutboxService } from '../../outbox/outbox.service';

/** Default overlap window for Wave 9 rotation (24 hours). */
export const DEFAULT_ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000;

/** Max overlap window (30 days). */
export const MAX_ROTATION_OVERLAP_MS = 30 * 24 * 60 * 60 * 1000;

const RETRY_JOB_LOCK = 'outbound-webhook-retry';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 5;

@Injectable()
export class OutboundWebhookService implements OnModuleInit {
  private readonly logger = new Logger(OutboundWebhookService.name);

  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepo: Repository<WebhookSubscription>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(WebhookDeadLetter)
    private readonly deadLetterRepo: Repository<WebhookDeadLetter>,
    private readonly httpService: HttpService,
    private readonly jobLock: JobLockService,
    private readonly metricsService: MetricsService,
    @Optional()
    @Inject(AuditService)
    private readonly auditService?: AuditService,
    @Optional()
    @Inject(OutboxService)
    private readonly outboxService?: OutboxService,
  ) {}

  onModuleInit() {
    if (this.outboxService) {
      this.outboxService.registerHandler(async (eventType, payload) => {
        try {
          await this.dispatch(eventType, payload);
        } catch (error) {
          this.logger.error(
            `Failed to dispatch outbox event ${eventType} to outbound webhooks: ${this.getErrorMessage(error)}`,
          );
        }
      });
      this.logger.log('Registered outbound webhook handler with OutboxService');
    }
  }

  // ==========================================
  // 1. Subscription Management
  // ==========================================

  async createSubscription(
    dto: CreateWebhookSubscriptionDto,
    actor?: string,
  ): Promise<WebhookSubscription> {
    const secret =
      dto.secret && dto.secret.trim().length > 0
        ? dto.secret.trim()
        : crypto.randomBytes(32).toString('hex');

    const secretId = randomUUID();

    const subscription = this.subscriptionRepo.create({
      name: dto.name.trim(),
      targetUrl: dto.targetUrl.trim(),
      eventTypes: dto.eventTypes,
      partnerId: dto.partnerId ?? null,
      status: WebhookSubscriptionStatus.ACTIVE,
      secret,
      secretId,
      previousSecret: null,
      previousSecretId: null,
      overlapExpiresAt: null,
      secretVersion: 1,
      metadata: dto.metadata ?? null,
    });

    const saved = await this.subscriptionRepo.save(subscription);

    if (this.auditService && actor) {
      await this.auditService.log('webhooks.subscription.create', actor, null, {
        subscriptionId: saved.id,
        name: saved.name,
        eventTypes: saved.eventTypes,
        targetUrl: saved.targetUrl,
        secretId: saved.secretId,
      });
    }

    this.logger.log(
      `Created webhook subscription ${saved.id} for target ${saved.targetUrl}`,
    );

    return saved;
  }

  async listSubscriptions(query: QuerySubscriptionsDto): Promise<{
    data: WebhookSubscription[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(0, query.page ?? 0);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const qb = this.subscriptionRepo.createQueryBuilder('sub');

    if (query.status) {
      qb.andWhere('sub.status = :status', { status: query.status });
    }

    if (query.partnerId) {
      qb.andWhere('sub.partnerId = :partnerId', {
        partnerId: query.partnerId,
      });
    }

    if (query.eventType) {
      qb.andWhere('sub.eventTypes ::jsonb @> :et', {
        et: JSON.stringify([query.eventType]),
      });
    }

    qb.orderBy('sub.createdAt', 'DESC')
      .skip(page * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getSubscription(id: string): Promise<WebhookSubscription> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { id },
    });
    if (!subscription) {
      throw new NotFoundException(`Webhook subscription not found: ${id}`);
    }
    return subscription;
  }

  async updateSubscription(
    id: string,
    dto: UpdateWebhookSubscriptionDto,
    actor?: string,
  ): Promise<WebhookSubscription> {
    const subscription = await this.getSubscription(id);

    if (dto.name !== undefined) subscription.name = dto.name.trim();
    if (dto.targetUrl !== undefined)
      subscription.targetUrl = dto.targetUrl.trim();
    if (dto.eventTypes !== undefined) subscription.eventTypes = dto.eventTypes;
    if (dto.status !== undefined) subscription.status = dto.status;
    if (dto.metadata !== undefined) subscription.metadata = dto.metadata;

    const saved = await this.subscriptionRepo.save(subscription);

    if (this.auditService && actor) {
      await this.auditService.log('webhooks.subscription.update', actor, null, {
        subscriptionId: saved.id,
        updates: dto,
      });
    }

    return saved;
  }

  async deleteSubscription(id: string, actor?: string): Promise<void> {
    const subscription = await this.getSubscription(id);

    await this.subscriptionRepo.remove(subscription);

    if (this.auditService && actor) {
      await this.auditService.log('webhooks.subscription.delete', actor, null, {
        subscriptionId: id,
        name: subscription.name,
      });
    }

    this.logger.log(`Deleted webhook subscription ${id}`);
  }

  // ==========================================
  // 2. Wave 9 Secret Rotation Mechanism
  // ==========================================

  async rotateSecret(
    id: string,
    dto: RotateWebhookSecretDto,
    actor?: string,
  ): Promise<{
    subscription: WebhookSubscription;
    newSecret: string;
    secretId: string;
    previousSecretId: string | null;
    overlapExpiresAt: Date | null;
    version: number;
  }> {
    const subscription = await this.getSubscription(id);

    const overlapMs = dto.overlapMs ?? DEFAULT_ROTATION_OVERLAP_MS;
    if (overlapMs < 0 || overlapMs > MAX_ROTATION_OVERLAP_MS) {
      throw new BadRequestException(
        `overlapMs must be an integer between 0 and ${MAX_ROTATION_OVERLAP_MS}`,
      );
    }

    const newSecret =
      dto.newSecret && dto.newSecret.trim().length > 0
        ? dto.newSecret.trim()
        : crypto.randomBytes(32).toString('hex');

    const now = Date.now();
    const previousSecret = subscription.secret;
    const previousSecretId = subscription.secretId;
    const overlapExpiresAt =
      overlapMs > 0 ? new Date(now + overlapMs) : new Date(now);

    const newSecretId = randomUUID();
    const newVersion = (subscription.secretVersion ?? 1) + 1;

    subscription.previousSecret = previousSecret;
    subscription.previousSecretId = previousSecretId;
    subscription.overlapExpiresAt = overlapExpiresAt;
    subscription.secret = newSecret;
    subscription.secretId = newSecretId;
    subscription.secretVersion = newVersion;

    const saved = await this.subscriptionRepo.save(subscription);

    if (this.auditService && actor) {
      await this.auditService.log('webhooks.secrets.rotate', actor, null, {
        subscriptionId: id,
        secretId: newSecretId,
        previousSecretId,
        overlapExpiresAt: overlapExpiresAt.toISOString(),
        version: newVersion,
        reason: dto.reason ?? null,
      });
    }

    this.logger.log(
      `Rotated secret for subscription ${id} to version ${newVersion} (overlap ${overlapMs}ms)`,
    );

    return {
      subscription: saved,
      newSecret,
      secretId: newSecretId,
      previousSecretId,
      overlapExpiresAt,
      version: newVersion,
    };
  }

  /**
   * Constant-time signature verification against the subscriber's active
   * or still-overlapping previous secret.
   */
  async verifySignature(
    subscriptionId: string,
    rawBody: Buffer | string,
    signatureHeader: string,
  ): Promise<boolean> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { id: subscriptionId },
    });
    if (!subscription || !signatureHeader) {
      return false;
    }

    const bodyBuffer = Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(rawBody, 'utf8');

    // Expected format: sha256=<hex>
    const [scheme, receivedHash] = signatureHeader.split('=');
    if (scheme !== 'sha256' || !receivedHash) {
      return false;
    }

    const acceptableSecrets: string[] = [subscription.secret];

    const now = Date.now();
    if (
      subscription.previousSecret &&
      subscription.overlapExpiresAt &&
      subscription.overlapExpiresAt.getTime() > now
    ) {
      acceptableSecrets.push(subscription.previousSecret);
    }

    const receivedBuf = Buffer.from(receivedHash, 'hex');

    return acceptableSecrets.some((sec) => {
      const expectedHash = crypto
        .createHmac('sha256', sec)
        .update(bodyBuffer)
        .digest('hex');
      const expectedBuf = Buffer.from(expectedHash, 'hex');

      return (
        expectedBuf.length === receivedBuf.length &&
        crypto.timingSafeEqual(expectedBuf, receivedBuf)
      );
    });
  }

  // ==========================================
  // 3. Dispatch & Delivery Orchestration
  // ==========================================

  /**
   * Dispatch an outbound event to all active matching subscriptions.
   */
  async dispatch(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<WebhookDelivery[]> {
    const activeSubscriptions = await this.subscriptionRepo.find({
      where: { status: WebhookSubscriptionStatus.ACTIVE },
    });

    const matchedSubscriptions = activeSubscriptions.filter((sub) =>
      this.isSubscribedTo(sub.eventTypes, eventType),
    );

    if (matchedSubscriptions.length === 0) {
      this.logger.debug(
        `No active subscriptions matched outbound event: ${eventType}`,
      );
      return [];
    }

    const deliveries: WebhookDelivery[] = [];

    for (const subscription of matchedSubscriptions) {
      const delivery = this.deliveryRepo.create({
        subscriptionId: subscription.id,
        eventType,
        payload,
        status: WebhookDeliveryStatus.PENDING,
        attempts: 0,
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
        nextRetryAt: null,
        responseStatusCode: null,
        responseBody: null,
        lastError: null,
        requestHeaders: null,
        executionDurationMs: null,
        deliveredAt: null,
      });

      const savedDelivery = await this.deliveryRepo.save(delivery);

      // Perform initial delivery attempt asynchronously
      await this.attemptDelivery(savedDelivery, subscription);
      deliveries.push(savedDelivery);
    }

    return deliveries;
  }

  /**
   * Attempt a single delivery to a subscriber endpoint.
   */
  async attemptDelivery(
    delivery: WebhookDelivery,
    subscription?: WebhookSubscription,
  ): Promise<WebhookDelivery> {
    const targetSub =
      subscription ?? (await this.getSubscription(delivery.subscriptionId));

    delivery.attempts += 1;
    const bodyString = JSON.stringify(delivery.payload);
    const headers = this.buildDeliveryHeaders(
      targetSub,
      bodyString,
      delivery.id,
      delivery.eventType,
    );
    delivery.requestHeaders = headers;

    const startTime = Date.now();

    try {
      const response = await firstValueFrom(
        this.httpService.post(targetSub.targetUrl, delivery.payload, {
          timeout: DEFAULT_TIMEOUT_MS,
          headers,
        }),
      );

      const duration = Date.now() - startTime;
      delivery.executionDurationMs = duration;
      delivery.responseStatusCode = response?.status ?? 200;
      delivery.responseBody = response?.data
        ? JSON.stringify(response.data).slice(0, 2048)
        : null;
      delivery.status = WebhookDeliveryStatus.DELIVERED;
      delivery.deliveredAt = new Date();
      delivery.lastError = null;
      delivery.nextRetryAt = null;

      this.metricsService
        .getOrCreateCounter(
          'webhook_outbound_deliveries_total',
          'Outbound webhook deliveries by outcome',
          ['status'],
        )
        .inc({ status: 'delivered' });

      this.logger.log(
        `Delivered webhook ${delivery.id} to ${targetSub.targetUrl} (${delivery.eventType}) in ${duration}ms`,
      );
    } catch (err: unknown) {
      const duration = Date.now() - startTime;
      delivery.executionDurationMs = duration;
      const errorMsg = this.getErrorMessage(err);
      delivery.lastError = errorMsg;

      const statusCode = (err as { response?: { status?: number } })?.response
        ?.status;
      if (typeof statusCode === 'number') {
        delivery.responseStatusCode = statusCode;
      }

      if (delivery.attempts >= delivery.maxAttempts) {
        delivery.status = WebhookDeliveryStatus.DEAD_LETTER;
        delivery.nextRetryAt = null;

        await this.moveToDeadLetter(delivery, errorMsg);

        this.metricsService
          .getOrCreateCounter(
            'webhook_outbound_deliveries_total',
            'Outbound webhook deliveries by outcome',
            ['status'],
          )
          .inc({ status: 'dead_letter' });

        this.logger.error(
          `Outbound webhook delivery ${delivery.id} (${delivery.eventType}) exceeded max attempts (${delivery.maxAttempts}). Moved to dead-letter queue.`,
        );
      } else {
        delivery.status = WebhookDeliveryStatus.FAILED;
        const delayMs = this.computeBackoffMs(delivery.attempts);
        delivery.nextRetryAt = new Date(Date.now() + delayMs);

        this.metricsService
          .getOrCreateCounter(
            'webhook_outbound_deliveries_total',
            'Outbound webhook deliveries by outcome',
            ['status'],
          )
          .inc({ status: 'failed' });

        this.logger.warn(
          `Delivery ${delivery.id} attempt ${delivery.attempts}/${delivery.maxAttempts} failed: ${errorMsg}. Next retry in ${delayMs}ms`,
        );
      }
    }

    return this.deliveryRepo.save(delivery);
  }

  /**
   * Build signed delivery headers per subscriber, including Wave 9 dual signing
   * if a rotated previous secret is within its overlap window.
   */
  buildDeliveryHeaders(
    subscription: WebhookSubscription,
    body: string,
    deliveryId: string,
    eventType: string,
  ): Record<string, string> {
    const timestamp = Date.now().toString();
    const activeSig = this.createHmacSha256(body, subscription.secret);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': eventType,
      'X-Webhook-Delivery-Id': deliveryId,
      'X-Webhook-Timestamp': timestamp,
      'X-Webhook-Signature': `sha256=${activeSig}`,
      'X-Webhook-Secret-Id': subscription.secretId,
    };

    // Wave 9 rotation: if previous secret exists and overlap is live, dual sign
    const now = Date.now();
    if (
      subscription.previousSecret &&
      subscription.overlapExpiresAt &&
      subscription.overlapExpiresAt.getTime() > now
    ) {
      const prevSig = this.createHmacSha256(body, subscription.previousSecret);
      headers['X-Webhook-Previous-Signature'] = `sha256=${prevSig}`;
      headers['X-Webhook-Previous-Secret-Id'] =
        subscription.previousSecretId ?? '';
    }

    return headers;
  }

  private createHmacSha256(body: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  private computeBackoffMs(attempt: number): number {
    // 5s * 2^(attempt - 1): 5s, 10s, 20s, 40s...
    const base = 5000;
    return Math.min(3600000, base * Math.pow(2, Math.max(0, attempt - 1)));
  }

  private isSubscribedTo(patterns: string[], eventType: string): boolean {
    if (!patterns || patterns.length === 0) return false;

    return patterns.some((pattern) => {
      if (pattern === '*' || pattern === eventType) return true;
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        return eventType.startsWith(`${prefix}.`);
      }
      return false;
    });
  }

  // ==========================================
  // 4. Background Retry Scheduler
  // ==========================================

  @Cron(CronExpression.EVERY_10_SECONDS)
  async processRetries(): Promise<void> {
    const acquired = await this.jobLock.tryAcquire(RETRY_JOB_LOCK);
    if (!acquired) {
      return;
    }

    try {
      const now = new Date();
      const pendingDeliveries = await this.deliveryRepo.find({
        where: {
          status: WebhookDeliveryStatus.FAILED,
          nextRetryAt: LessThanOrEqual(now),
        },
        relations: ['subscription'],
        take: 50,
      });

      if (pendingDeliveries.length === 0) {
        return;
      }

      this.logger.log(
        `Processing ${pendingDeliveries.length} retry delivery attempts...`,
      );

      for (const delivery of pendingDeliveries) {
        if (!delivery.subscription) {
          delivery.subscription = await this.getSubscription(
            delivery.subscriptionId,
          );
        }
        await this.attemptDelivery(delivery, delivery.subscription);
      }
    } finally {
      await this.jobLock.release(RETRY_JOB_LOCK);
    }
  }

  // ==========================================
  // 5. Dead-Letter Queue (DLQ)
  // ==========================================

  private async moveToDeadLetter(
    delivery: WebhookDelivery,
    errorMessage: string,
  ): Promise<WebhookDeadLetter> {
    let deadLetter = await this.deadLetterRepo.findOne({
      where: { deliveryId: delivery.id },
    });

    const errorEntry = {
      timestamp: new Date().toISOString(),
      error: errorMessage,
      statusCode: delivery.responseStatusCode,
    };

    if (!deadLetter) {
      deadLetter = this.deadLetterRepo.create({
        deliveryId: delivery.id,
        subscriptionId: delivery.subscriptionId,
        eventType: delivery.eventType,
        payload: delivery.payload,
        attempts: delivery.attempts,
        lastErrorMessage: errorMessage,
        errorHistory: [errorEntry],
        status: WebhookDeadLetterStatus.PENDING,
        maintainerNotes: null,
        resolvedBy: null,
        resolvedAt: null,
        replayedAt: null,
        replayCount: 0,
      });
    } else {
      deadLetter.attempts = delivery.attempts;
      deadLetter.lastErrorMessage = errorMessage;
      deadLetter.errorHistory = [...deadLetter.errorHistory, errorEntry];
      deadLetter.status = WebhookDeadLetterStatus.PENDING;
    }

    return this.deadLetterRepo.save(deadLetter);
  }

  async listDeadLetters(query: QueryDeadLetterDto): Promise<{
    data: WebhookDeadLetter[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(0, query.page ?? 0);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const qb = this.deadLetterRepo.createQueryBuilder('dlq');

    if (query.status) {
      qb.andWhere('dlq.status = :status', { status: query.status });
    }

    if (query.subscriptionId) {
      qb.andWhere('dlq.subscriptionId = :subId', {
        subId: query.subscriptionId,
      });
    }

    if (query.eventType) {
      qb.andWhere('dlq.eventType = :et', { et: query.eventType });
    }

    qb.orderBy('dlq.createdAt', 'DESC')
      .skip(page * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async inspectDeadLetter(id: string): Promise<WebhookDeadLetter> {
    const entry = await this.deadLetterRepo.findOne({ where: { id } });
    if (!entry) {
      throw new NotFoundException(`Dead-letter webhook entry not found: ${id}`);
    }
    return entry;
  }

  async replayDeadLetter(
    id: string,
    actor?: string,
  ): Promise<WebhookDeadLetter> {
    const deadLetter = await this.inspectDeadLetter(id);

    const delivery = await this.deliveryRepo.findOne({
      where: { id: deadLetter.deliveryId },
      relations: ['subscription'],
    });

    if (!delivery) {
      throw new NotFoundException(
        `Original delivery record not found for dead-letter: ${deadLetter.deliveryId}`,
      );
    }

    const subscription =
      delivery.subscription ??
      (await this.getSubscription(delivery.subscriptionId));

    deadLetter.replayCount += 1;

    try {
      const bodyString = JSON.stringify(delivery.payload);
      const headers = this.buildDeliveryHeaders(
        subscription,
        bodyString,
        delivery.id,
        delivery.eventType,
      );

      const response = await firstValueFrom(
        this.httpService.post(subscription.targetUrl, delivery.payload, {
          timeout: DEFAULT_TIMEOUT_MS,
          headers,
        }),
      );

      delivery.status = WebhookDeliveryStatus.DELIVERED;
      delivery.deliveredAt = new Date();
      delivery.responseStatusCode = response?.status ?? 200;
      delivery.lastError = null;
      await this.deliveryRepo.save(delivery);

      deadLetter.status = WebhookDeadLetterStatus.REPLAYED;
      deadLetter.replayedAt = new Date();
      deadLetter.maintainerNotes = actor
        ? `Replayed by ${actor}`
        : deadLetter.maintainerNotes;

      this.logger.log(
        `Successfully replayed dead-letter webhook ${id} to ${subscription.targetUrl}`,
      );
    } catch (err: unknown) {
      const errorMsg = this.getErrorMessage(err);
      deadLetter.lastErrorMessage = errorMsg;
      deadLetter.errorHistory = [
        ...deadLetter.errorHistory,
        {
          timestamp: new Date().toISOString(),
          error: `Replay failed: ${errorMsg}`,
          statusCode: (err as { response?: { status?: number } })?.response
            ?.status,
        },
      ];
      this.logger.error(`Replay of dead-letter ${id} failed: ${errorMsg}`);
    }

    return this.deadLetterRepo.save(deadLetter);
  }

  async resolveDeadLetter(
    id: string,
    dto: ResolveWebhookDeadLetterDto,
    actor?: string,
  ): Promise<WebhookDeadLetter> {
    const deadLetter = await this.inspectDeadLetter(id);

    deadLetter.status = WebhookDeadLetterStatus.RESOLVED;
    deadLetter.resolvedAt = new Date();
    deadLetter.resolvedBy = actor ?? 'system';
    const notes = dto.maintainerNotes || dto.reason;
    if (notes) {
      deadLetter.maintainerNotes = notes;
    }

    return this.deadLetterRepo.save(deadLetter);
  }

  // ==========================================
  // 6. Delivery History Per Subscriber
  // ==========================================

  async getDeliveriesForSubscription(
    subscriptionId: string,
    query: QueryDeliveriesDto,
  ): Promise<{
    data: WebhookDelivery[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    // Assert subscription exists
    await this.getSubscription(subscriptionId);

    const page = Math.max(0, query.page ?? 0);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const qb = this.deliveryRepo.createQueryBuilder('del');
    qb.where('del.subscriptionId = :subscriptionId', { subscriptionId });

    if (query.status) {
      qb.andWhere('del.status = :status', { status: query.status });
    }

    if (query.eventType) {
      qb.andWhere('del.eventType = :et', { et: query.eventType });
    }

    qb.orderBy('del.createdAt', 'DESC')
      .skip(page * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getDelivery(
    subscriptionId: string,
    deliveryId: string,
  ): Promise<WebhookDelivery> {
    const delivery = await this.deliveryRepo.findOne({
      where: { id: deliveryId, subscriptionId },
    });
    if (!delivery) {
      throw new NotFoundException(
        `Webhook delivery ${deliveryId} not found for subscription ${subscriptionId}`,
      );
    }
    return delivery;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Unknown error';
  }
}
