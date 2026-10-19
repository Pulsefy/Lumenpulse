import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import * as crypto from 'crypto';
import { OutboundWebhookService } from './outbound-webhook.service';
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
import { JobLockService } from '../../scheduler/job-lock.service';
import { MetricsService } from '../../metrics/metrics.service';
import { AuditService } from '../../audit/audit.service';
import { OutboxService } from '../../outbox/outbox.service';

describe('OutboundWebhookService', () => {
  let service: OutboundWebhookService;
  let subRepo: any;
  let deliveryRepo: any;
  let deadLetterRepo: any;
  let httpService: any;
  let jobLock: any;
  let metricsService: any;
  let auditService: any;
  let outboxService: any;

  interface MockEntity {
    id?: string;
    [key: string]: unknown;
  }

  beforeEach(async () => {
    subRepo = {
      create: jest.fn(
        (dto: MockEntity): MockEntity => ({
          id: 'sub-1',
          ...dto,
        }),
      ),
      save: jest.fn(
        (entity: MockEntity): Promise<MockEntity> =>
          Promise.resolve({ ...entity, id: entity.id || 'sub-1' }),
      ),
      findOne: jest.fn(),
      find: jest.fn(),
      remove: jest.fn(
        (entity: MockEntity): Promise<MockEntity> => Promise.resolve(entity),
      ),
      createQueryBuilder: jest.fn(),
    };

    deliveryRepo = {
      create: jest.fn(
        (dto: MockEntity): MockEntity => ({
          id: 'del-1',
          ...dto,
        }),
      ),
      save: jest.fn(
        (entity: MockEntity): Promise<MockEntity> =>
          Promise.resolve({ ...entity, id: entity.id || 'del-1' }),
      ),
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    deadLetterRepo = {
      create: jest.fn(
        (dto: MockEntity): MockEntity => ({
          id: 'dlq-1',
          ...dto,
        }),
      ),
      save: jest.fn(
        (entity: MockEntity): Promise<MockEntity> =>
          Promise.resolve({ ...entity, id: entity.id || 'dlq-1' }),
      ),
      findOne: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    httpService = {
      post: jest.fn(),
    };

    jobLock = {
      tryAcquire: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    };

    metricsService = {
      getOrCreateCounter: jest.fn().mockReturnValue({ inc: jest.fn() }),
      getOrCreateGauge: jest.fn().mockReturnValue({ set: jest.fn() }),
    };

    auditService = {
      log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    outboxService = {
      registerHandler: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboundWebhookService,
        {
          provide: getRepositoryToken(WebhookSubscription),
          useValue: subRepo,
        },
        {
          provide: getRepositoryToken(WebhookDelivery),
          useValue: deliveryRepo,
        },
        {
          provide: getRepositoryToken(WebhookDeadLetter),
          useValue: deadLetterRepo,
        },
        {
          provide: HttpService,
          useValue: httpService,
        },
        {
          provide: JobLockService,
          useValue: jobLock,
        },
        {
          provide: MetricsService,
          useValue: metricsService,
        },
        {
          provide: AuditService,
          useValue: auditService,
        },
        {
          provide: OutboxService,
          useValue: outboxService,
        },
      ],
    }).compile();

    service = module.get<OutboundWebhookService>(OutboundWebhookService);
  });

  describe('1. Registration and Subscriptions', () => {
    it('registers an endpoint with subscribed event types and generates a subscriber secret', async () => {
      const dto = {
        name: 'Partner Integration',
        targetUrl: 'https://partner.example.com/webhook',
        eventTypes: ['pool.round_finalized', 'milestone.approved'],
        partnerId: 'partner-xyz',
      };

      const result = await service.createSubscription(dto, 'admin-user');

      expect(subRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Partner Integration',
          targetUrl: 'https://partner.example.com/webhook',
          eventTypes: ['pool.round_finalized', 'milestone.approved'],
          partnerId: 'partner-xyz',
          status: WebhookSubscriptionStatus.ACTIVE,
          secretVersion: 1,
        }),
      );
      expect(result.secret).toBeDefined();
      expect(result.secret.length).toBeGreaterThanOrEqual(32);
      expect(result.secretId).toBeDefined();
      expect(auditService.log).toHaveBeenCalledWith(
        'webhooks.subscription.create',
        'admin-user',
        null,
        expect.any(Object),
      );
    });

    it('updates subscription endpoint and event types', async () => {
      const existing = {
        id: 'sub-1',
        name: 'Old Name',
        targetUrl: 'https://old.example.com',
        eventTypes: ['pool.round_finalized'],
        status: WebhookSubscriptionStatus.ACTIVE,
      } as WebhookSubscription;

      subRepo.findOne.mockResolvedValue(existing);

      const updated = await service.updateSubscription(
        'sub-1',
        {
          targetUrl: 'https://new.example.com',
          eventTypes: ['pool.round_finalized', 'milestone.approved'],
        },
        'admin-user',
      );

      expect(updated.targetUrl).toBe('https://new.example.com');
      expect(updated.eventTypes).toEqual([
        'pool.round_finalized',
        'milestone.approved',
      ]);
      expect(auditService.log).toHaveBeenCalledWith(
        'webhooks.subscription.update',
        'admin-user',
        null,
        expect.any(Object),
      );
    });

    it('throws NotFoundException when subscription is not found', async () => {
      subRepo.findOne.mockResolvedValue(null);

      await expect(service.getSubscription('non-existent')).rejects.toThrow(
        'Webhook subscription not found',
      );
    });
  });

  describe('2. Delivery signing with per-subscriber secret', () => {
    it('signs deliveries using subscriber secret with HMAC-SHA256', () => {
      const secret = 'partner-secret-1234567890abcdef123456';
      const subscription = {
        id: 'sub-1',
        name: 'Partner Alpha',
        targetUrl: 'https://partner.example.com/events',
        eventTypes: ['pool.round_finalized'],
        status: WebhookSubscriptionStatus.ACTIVE,
        secret,
        secretId: 'sec-v1',
        previousSecret: null,
        previousSecretId: null,
        overlapExpiresAt: null,
        secretVersion: 1,
      } as WebhookSubscription;

      const payload = { roundId: 42, totalPool: '500000' };
      const body = JSON.stringify(payload);

      const headers = service.buildDeliveryHeaders(
        subscription,
        body,
        'del-1',
        'pool.round_finalized',
      );

      expect(headers['X-Webhook-Event']).toBe('pool.round_finalized');
      expect(headers['X-Webhook-Delivery-Id']).toBe('del-1');
      expect(headers['X-Webhook-Secret-Id']).toBe('sec-v1');
      expect(headers['X-Webhook-Timestamp']).toBeDefined();

      const expectedHmac =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');
      expect(headers['X-Webhook-Signature']).toBe(expectedHmac);
      expect(headers['X-Webhook-Previous-Signature']).toBeUndefined();
    });

    it('verifies signature in constant-time with verifySignature', async () => {
      const secret = 'partner-secret-test';
      const subscription = {
        id: 'sub-1',
        secret,
        secretId: 'sec-v1',
        previousSecret: null,
        overlapExpiresAt: null,
      } as WebhookSubscription;

      subRepo.findOne.mockResolvedValue(subscription);

      const body = JSON.stringify({ event: 'test' });
      const validHmac =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(body).digest('hex');

      const isValid = await service.verifySignature('sub-1', body, validHmac);
      expect(isValid).toBe(true);

      const isInvalid = await service.verifySignature(
        'sub-1',
        body,
        'sha256=invalidhash',
      );
      expect(isInvalid).toBe(false);
    });
  });

  describe('3. Wave 9 Secret Rotation Mechanism', () => {
    it('supports secret rotation with overlap window and dual signing', async () => {
      const oldSecret = 'old-secret-version-1';
      const oldSecretId = 'sec-v1';
      const subscription = {
        id: 'sub-1',
        name: 'Partner Alpha',
        targetUrl: 'https://partner.example.com/webhook',
        eventTypes: ['milestone.approved'],
        status: WebhookSubscriptionStatus.ACTIVE,
        secret: oldSecret,
        secretId: oldSecretId,
        previousSecret: null,
        previousSecretId: null,
        overlapExpiresAt: null,
        secretVersion: 1,
      } as WebhookSubscription;

      subRepo.findOne.mockResolvedValue(subscription);

      const rotateResult = await service.rotateSecret(
        'sub-1',
        {
          newSecret: 'new-secret-version-2',
          overlapMs: 86400000, // 24h
          reason: 'Scheduled rotation',
        },
        'admin-user',
      );

      expect(rotateResult.version).toBe(2);
      expect(rotateResult.secretId).toBeDefined();
      expect(rotateResult.previousSecretId).toBe(oldSecretId);
      expect(rotateResult.overlapExpiresAt).toBeDefined();
      expect(rotateResult.newSecret).toBe('new-secret-version-2');

      expect(subscription.secret).toBe('new-secret-version-2');
      expect(subscription.previousSecret).toBe(oldSecret);

      expect(auditService.log).toHaveBeenCalledWith(
        'webhooks.secrets.rotate',
        'admin-user',
        null,
        expect.objectContaining({
          subscriptionId: 'sub-1',
          version: 2,
          reason: 'Scheduled rotation',
        }),
      );

      // Verify that during overlap, dual signing generates both current and previous signature headers
      const payload = { milestoneId: 'm-101', status: 'approved' };
      const body = JSON.stringify(payload);

      const headers = service.buildDeliveryHeaders(
        subscription,
        body,
        'del-2',
        'milestone.approved',
      );

      const expectedNewSig =
        'sha256=' +
        crypto
          .createHmac('sha256', 'new-secret-version-2')
          .update(body)
          .digest('hex');
      const expectedOldSig =
        'sha256=' +
        crypto.createHmac('sha256', oldSecret).update(body).digest('hex');

      expect(headers['X-Webhook-Signature']).toBe(expectedNewSig);
      expect(headers['X-Webhook-Secret-Id']).toBe(rotateResult.secretId);
      expect(headers['X-Webhook-Previous-Signature']).toBe(expectedOldSig);
      expect(headers['X-Webhook-Previous-Secret-Id']).toBe(oldSecretId);

      // And verification passes for both new and previous secret during the overlap window
      expect(await service.verifySignature('sub-1', body, expectedNewSig)).toBe(
        true,
      );
      expect(await service.verifySignature('sub-1', body, expectedOldSig)).toBe(
        true,
      );
    });

    it('rejects previous secret after overlap window expires', async () => {
      const oldSecret = 'expired-old-secret';
      const newSecret = 'active-new-secret';
      const pastDate = new Date(Date.now() - 1000); // expired 1s ago

      const subscription = {
        id: 'sub-1',
        secret: newSecret,
        secretId: 'sec-v2',
        previousSecret: oldSecret,
        previousSecretId: 'sec-v1',
        overlapExpiresAt: pastDate,
        secretVersion: 2,
      } as WebhookSubscription;

      subRepo.findOne.mockResolvedValue(subscription);

      const body = JSON.stringify({ event: 'test' });
      const oldSig =
        'sha256=' +
        crypto.createHmac('sha256', oldSecret).update(body).digest('hex');
      const newSig =
        'sha256=' +
        crypto.createHmac('sha256', newSecret).update(body).digest('hex');

      // Previous secret is expired -> verification fails
      expect(await service.verifySignature('sub-1', body, oldSig)).toBe(false);
      // New secret is valid -> verification succeeds
      expect(await service.verifySignature('sub-1', body, newSig)).toBe(true);

      // And headers omit previous secret headers
      const headers = service.buildDeliveryHeaders(
        subscription,
        body,
        'del-3',
        'test',
      );
      expect(headers['X-Webhook-Previous-Signature']).toBeUndefined();
    });
  });

  describe('4. Failed deliveries retry with backoff and land in dead-letter queue', () => {
    it('dispatches to matching subscriptions and records successful delivery', async () => {
      const subscription = {
        id: 'sub-1',
        targetUrl: 'https://partner.example.com/webhooks',
        eventTypes: ['pool.round_finalized'],
        status: WebhookSubscriptionStatus.ACTIVE,
        secret: 'test-secret',
        secretId: 'sec-1',
      } as WebhookSubscription;

      subRepo.find.mockResolvedValue([subscription]);
      httpService.post.mockReturnValue(
        of({ status: 200, data: { received: true } }),
      );

      const deliveries = await service.dispatch('pool.round_finalized', {
        roundId: 1,
      });

      expect(deliveries).toHaveLength(1);
      expect(httpService.post).toHaveBeenCalledWith(
        'https://partner.example.com/webhooks',
        { roundId: 1 },
        expect.any(Object),
      );
      expect(deliveries[0].status).toBe(WebhookDeliveryStatus.DELIVERED);
      expect(deliveries[0].deliveredAt).toBeDefined();
    });

    it('schedules retry with exponential backoff on delivery failure', async () => {
      const subscription = {
        id: 'sub-1',
        targetUrl: 'https://partner.example.com/webhooks',
        eventTypes: ['milestone.approved'],
        status: WebhookSubscriptionStatus.ACTIVE,
        secret: 'test-secret',
        secretId: 'sec-1',
      } as WebhookSubscription;

      subRepo.find.mockResolvedValue([subscription]);
      httpService.post.mockReturnValue(
        throwError(() => new Error('Connection timed out')),
      );

      const deliveries = await service.dispatch('milestone.approved', {
        milestoneId: 'm-1',
      });

      expect(deliveries).toHaveLength(1);
      const delivery = deliveries[0];
      expect(delivery.status).toBe(WebhookDeliveryStatus.FAILED);
      expect(delivery.attempts).toBe(1);
      expect(delivery.lastError).toContain('Connection timed out');
      expect(delivery.nextRetryAt).toBeDefined();
      expect(delivery.nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('moves delivery to dead-letter queue when max attempts are exceeded', async () => {
      const subscription = {
        id: 'sub-1',
        targetUrl: 'https://partner.example.com/webhooks',
        eventTypes: ['milestone.approved'],
        status: WebhookSubscriptionStatus.ACTIVE,
        secret: 'test-secret',
        secretId: 'sec-1',
      } as WebhookSubscription;

      const delivery = {
        id: 'del-exhausted',
        subscriptionId: 'sub-1',
        eventType: 'milestone.approved',
        payload: { milestoneId: 'm-99' },
        status: WebhookDeliveryStatus.FAILED,
        attempts: 4,
        maxAttempts: 5,
      } as WebhookDelivery;

      subRepo.findOne.mockResolvedValue(subscription);
      httpService.post.mockReturnValue(
        throwError(() => new Error('HTTP 503 Service Unavailable')),
      );

      await service.attemptDelivery(delivery, subscription);

      expect(delivery.attempts).toBe(5);
      expect(delivery.status).toBe(WebhookDeliveryStatus.DEAD_LETTER);
      expect(delivery.nextRetryAt).toBeNull();

      expect(deadLetterRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: 'del-exhausted',
          subscriptionId: 'sub-1',
          eventType: 'milestone.approved',
          attempts: 5,
          status: WebhookDeadLetterStatus.PENDING,
          lastErrorMessage: 'HTTP 503 Service Unavailable',
        }),
      );
      expect(deadLetterRepo.save).toHaveBeenCalled();
    });

    it('replays a dead-lettered event and updates status to replayed upon success', async () => {
      const deadLetter = {
        id: 'dlq-1',
        deliveryId: 'del-1',
        subscriptionId: 'sub-1',
        eventType: 'pool.round_finalized',
        payload: { roundId: 10 },
        attempts: 5,
        status: WebhookDeadLetterStatus.PENDING,
        replayCount: 0,
        errorHistory: [],
      } as unknown as WebhookDeadLetter;

      const delivery = {
        id: 'del-1',
        subscriptionId: 'sub-1',
        eventType: 'pool.round_finalized',
        payload: { roundId: 10 },
        status: WebhookDeliveryStatus.DEAD_LETTER,
      } as WebhookDelivery;

      const subscription = {
        id: 'sub-1',
        targetUrl: 'https://partner.example.com/webhooks',
        secret: 'test-secret',
        secretId: 'sec-1',
      } as WebhookSubscription;

      deadLetterRepo.findOne.mockResolvedValue(deadLetter);
      deliveryRepo.findOne.mockResolvedValue(delivery);
      subRepo.findOne.mockResolvedValue(subscription);
      httpService.post.mockReturnValue(of({ status: 200, data: { ok: true } }));

      const replayed = await service.replayDeadLetter('dlq-1', 'admin-actor');

      expect(replayed.status).toBe(WebhookDeadLetterStatus.REPLAYED);
      expect(replayed.replayCount).toBe(1);
      expect(replayed.replayedAt).toBeDefined();
      expect(delivery.status).toBe(WebhookDeliveryStatus.DELIVERED);
    });

    it('marks dead-lettered event as resolved', async () => {
      const deadLetter = {
        id: 'dlq-1',
        status: WebhookDeadLetterStatus.PENDING,
      } as WebhookDeadLetter;

      deadLetterRepo.findOne.mockResolvedValue(deadLetter);

      const resolved = await service.resolveDeadLetter(
        'dlq-1',
        { reason: 'Acknowledged deprecated webhook endpoint' },
        'admin-user',
      );

      expect(resolved.status).toBe(WebhookDeadLetterStatus.RESOLVED);
      expect(resolved.maintainerNotes).toBe(
        'Acknowledged deprecated webhook endpoint',
      );
      expect(resolved.resolvedBy).toBe('admin-user');
      expect(resolved.resolvedAt).toBeDefined();
    });
  });

  describe('5. Delivery history is queryable per subscriber', () => {
    it('queries delivery history per subscriber', async () => {
      const subscription = {
        id: 'sub-1',
      } as WebhookSubscription;

      subRepo.findOne.mockResolvedValue(subscription);

      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([
          [
            {
              id: 'del-1',
              subscriptionId: 'sub-1',
              eventType: 'pool.round_finalized',
              status: WebhookDeliveryStatus.DELIVERED,
            },
          ],
          1,
        ]),
      };
      deliveryRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getDeliveriesForSubscription('sub-1', {
        page: 0,
        limit: 10,
        status: WebhookDeliveryStatus.DELIVERED,
      });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(qb.where).toHaveBeenCalledWith(
        'del.subscriptionId = :subscriptionId',
        { subscriptionId: 'sub-1' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('del.status = :status', {
        status: WebhookDeliveryStatus.DELIVERED,
      });
    });

    it('inspects a single delivery record', async () => {
      const delivery = {
        id: 'del-1',
        subscriptionId: 'sub-1',
        eventType: 'pool.round_finalized',
        status: WebhookDeliveryStatus.DELIVERED,
      } as WebhookDelivery;

      deliveryRepo.findOne.mockResolvedValue(delivery);

      const res = await service.getDelivery('sub-1', 'del-1');
      expect(res.id).toBe('del-1');
    });
  });
});
