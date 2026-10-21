import { Test, TestingModule } from '@nestjs/testing';
import { WebhookSubscriptionController } from './webhook-subscription.controller';
import { OutboundWebhookService } from './outbound-webhook.service';
import { WebhookSubscriptionStatus } from './entities/webhook-subscription.entity';
import { WebhookDeliveryStatus } from './entities/webhook-delivery.entity';

describe('WebhookSubscriptionController', () => {
  let controller: WebhookSubscriptionController;
  let service: Partial<OutboundWebhookService>;

  const mockUser = { id: 'partner-123', email: 'partner@example.com' };
  const mockReq = { user: mockUser } as any;

  beforeEach(async () => {
    service = {
      createSubscription: jest.fn().mockResolvedValue({
        id: 'sub-1',
        partnerId: 'partner-123',
        name: 'Partner Webhook',
        targetUrl: 'https://partner.example.com/webhook',
        eventTypes: ['pool.round_finalized', 'milestone.approved'],
        status: WebhookSubscriptionStatus.ACTIVE,
        secret: 'whsec_active_secret_123',
        secretId: 'whsec_id_1',
        secretVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      listSubscriptions: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'sub-1',
            partnerId: 'partner-123',
            name: 'Partner Webhook',
            targetUrl: 'https://partner.example.com/webhook',
            eventTypes: ['pool.round_finalized'],
            status: WebhookSubscriptionStatus.ACTIVE,
            secretId: 'whsec_id_1',
            secretVersion: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      }),
      getSubscription: jest.fn().mockResolvedValue({
        id: 'sub-1',
        partnerId: 'partner-123',
        name: 'Partner Webhook',
        targetUrl: 'https://partner.example.com/webhook',
        eventTypes: ['pool.round_finalized'],
        status: WebhookSubscriptionStatus.ACTIVE,
        secretId: 'whsec_id_1',
        secretVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      updateSubscription: jest.fn().mockResolvedValue({
        id: 'sub-1',
        partnerId: 'partner-123',
        name: 'Updated Name',
        targetUrl: 'https://partner.example.com/new-endpoint',
        eventTypes: ['pool.*'],
        status: WebhookSubscriptionStatus.ACTIVE,
        secretId: 'whsec_id_1',
        secretVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      deleteSubscription: jest.fn().mockResolvedValue(undefined),
      rotateSecret: jest.fn().mockResolvedValue({
        secretId: 'whsec_id_2',
        previousSecretId: 'whsec_id_1',
        overlapExpiresAt: new Date(Date.now() + 86400000),
        newSecret: 'whsec_new_secret_456',
        version: 2,
      }),
      getDeliveriesForSubscription: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'del-1',
            subscriptionId: 'sub-1',
            eventType: 'pool.round_finalized',
            status: WebhookDeliveryStatus.DELIVERED,
            attempts: 1,
            maxAttempts: 5,
            responseStatusCode: 200,
            createdAt: new Date(),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      }),
      getDelivery: jest.fn().mockResolvedValue({
        id: 'del-1',
        subscriptionId: 'sub-1',
        eventType: 'pool.round_finalized',
        status: WebhookDeliveryStatus.DELIVERED,
        attempts: 1,
        maxAttempts: 5,
        responseStatusCode: 200,
        createdAt: new Date(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookSubscriptionController],
      providers: [
        {
          provide: OutboundWebhookService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<WebhookSubscriptionController>(
      WebhookSubscriptionController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createSubscription', () => {
    it('creates a new webhook subscription and returns secret', async () => {
      const dto = {
        name: 'Partner Webhook',
        targetUrl: 'https://partner.example.com/webhook',
        eventTypes: ['pool.round_finalized', 'milestone.approved'],
      };

      const result = await controller.createSubscription(dto, mockReq);

      expect(result.id).toBe('sub-1');
      expect(result.secret).toBe('whsec_active_secret_123');
      expect(service.createSubscription).toHaveBeenCalledWith(
        dto,
        'partner-123',
      );
    });
  });

  describe('listSubscriptions', () => {
    it('returns subscriptions list', async () => {
      const result = await controller.listSubscriptions({});

      expect(result).toHaveLength(1);
      expect(service.listSubscriptions).toHaveBeenCalledWith({});
    });
  });

  describe('getSubscription', () => {
    it('returns single subscription details', async () => {
      const result = await controller.getSubscription('sub-1');

      expect(result.id).toBe('sub-1');
      expect(service.getSubscription).toHaveBeenCalledWith('sub-1');
    });
  });

  describe('updateSubscription', () => {
    it('updates subscription parameters', async () => {
      const dto = {
        name: 'Updated Name',
        targetUrl: 'https://partner.example.com/new-endpoint',
        eventTypes: ['pool.*'],
      };

      const result = await controller.updateSubscription('sub-1', dto, mockReq);

      expect(result.name).toBe('Updated Name');
      expect(service.updateSubscription).toHaveBeenCalledWith(
        'sub-1',
        dto,
        'partner-123',
      );
    });
  });

  describe('deleteSubscription', () => {
    it('deletes subscription', async () => {
      await controller.deleteSubscription('sub-1', mockReq);

      expect(service.deleteSubscription).toHaveBeenCalledWith(
        'sub-1',
        'partner-123',
      );
    });
  });

  describe('rotateSecret', () => {
    it('rotates subscriber secret using Wave 9 mechanism', async () => {
      const dto = { overlapMs: 86400000 };
      const result = await controller.rotateSecret('sub-1', dto, mockReq);

      expect(result.version).toBe(2);
      expect(result.previousSecretId).toBe('whsec_id_1');
      expect(result.newSecret).toBe('whsec_new_secret_456');
      expect(service.rotateSecret).toHaveBeenCalledWith(
        'sub-1',
        dto,
        'partner-123',
      );
    });
  });

  describe('getDeliveries', () => {
    it('returns delivery history for a subscriber', async () => {
      const result = await controller.getDeliveries('sub-1', {
        page: 1,
        limit: 20,
      });

      expect(result.data).toHaveLength(1);
      expect(service.getDeliveriesForSubscription).toHaveBeenCalledWith(
        'sub-1',
        {
          page: 1,
          limit: 20,
        },
      );
    });
  });

  describe('getDelivery', () => {
    it('inspects a specific delivery by id', async () => {
      const result = await controller.getDelivery('sub-1', 'del-1');

      expect(result.id).toBe('del-1');
      expect(service.getDelivery).toHaveBeenCalledWith('sub-1', 'del-1');
    });
  });
});
