import { Test, TestingModule } from '@nestjs/testing';
import { WebhookDeadLetterController } from './webhook-dead-letter.controller';
import { OutboundWebhookService } from './outbound-webhook.service';
import { WebhookDeadLetterStatus } from './entities/webhook-dead-letter.entity';

describe('WebhookDeadLetterController', () => {
  let controller: WebhookDeadLetterController;
  let service: Partial<OutboundWebhookService>;

  const mockAdminUser = {
    id: 'admin-999',
    email: 'admin@lumenpulse.io',
    roles: ['admin'],
  };
  const mockReq = { user: mockAdminUser } as any;

  beforeEach(async () => {
    service = {
      listDeadLetters: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'dlq-1',
            deliveryId: 'del-1',
            subscriptionId: 'sub-1',
            eventType: 'pool.round_finalized',
            payload: { roundId: 'round-10' },
            attempts: 5,
            lastErrorMessage: 'ECONNREFUSED',
            status: WebhookDeadLetterStatus.PENDING,
            errorHistory: ['ECONNREFUSED'],
            replayCount: 0,
            createdAt: new Date(),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      }),
      inspectDeadLetter: jest.fn().mockResolvedValue({
        id: 'dlq-1',
        deliveryId: 'del-1',
        subscriptionId: 'sub-1',
        eventType: 'pool.round_finalized',
        payload: { roundId: 'round-10' },
        attempts: 5,
        lastErrorMessage: 'ECONNREFUSED',
        status: WebhookDeadLetterStatus.PENDING,
        errorHistory: ['ECONNREFUSED'],
        replayCount: 0,
        createdAt: new Date(),
      }),
      replayDeadLetter: jest.fn().mockResolvedValue({
        id: 'dlq-1',
        deliveryId: 'del-1',
        subscriptionId: 'sub-1',
        eventType: 'pool.round_finalized',
        payload: { roundId: 'round-10' },
        attempts: 5,
        lastErrorMessage: 'ECONNREFUSED',
        status: WebhookDeadLetterStatus.REPLAYED,
        errorHistory: ['ECONNREFUSED'],
        replayCount: 1,
        replayedAt: new Date(),
        createdAt: new Date(),
      }),
      resolveDeadLetter: jest.fn().mockResolvedValue({
        id: 'dlq-1',
        deliveryId: 'del-1',
        subscriptionId: 'sub-1',
        eventType: 'pool.round_finalized',
        payload: { roundId: 'round-10' },
        attempts: 5,
        lastErrorMessage: 'ECONNREFUSED',
        status: WebhookDeadLetterStatus.RESOLVED,
        resolvedBy: 'admin-999',
        maintainerNotes: 'Customer verified endpoint fix',
        resolvedAt: new Date(),
        replayCount: 0,
        createdAt: new Date(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhookDeadLetterController],
      providers: [
        {
          provide: OutboundWebhookService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<WebhookDeadLetterController>(
      WebhookDeadLetterController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listDeadLetters', () => {
    it('returns paginated dead-letter records', async () => {
      const result = await controller.listDeadLetters({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('dlq-1');
      expect(service.listDeadLetters).toHaveBeenCalledWith({
        page: 1,
        limit: 20,
      });
    });
  });

  describe('inspectDeadLetter', () => {
    it('returns a dead-letter entry by id', async () => {
      const result = await controller.inspectDeadLetter('dlq-1');

      expect(result.id).toBe('dlq-1');
      expect(service.inspectDeadLetter).toHaveBeenCalledWith('dlq-1');
    });
  });

  describe('replayDeadLetter', () => {
    it('triggers a manual replay for dead-letter delivery', async () => {
      const result = await controller.replayDeadLetter('dlq-1', mockReq);

      expect(result.status).toBe(WebhookDeadLetterStatus.REPLAYED);
      expect(service.replayDeadLetter).toHaveBeenCalledWith(
        'dlq-1',
        'admin-999',
      );
    });
  });

  describe('resolveDeadLetter', () => {
    it('resolves a dead-letter entry with maintainer notes', async () => {
      const dto = { maintainerNotes: 'Customer verified endpoint fix' };
      const result = await controller.resolveDeadLetter('dlq-1', dto, mockReq);

      expect(result.status).toBe(WebhookDeadLetterStatus.RESOLVED);
      expect(result.resolvedBy).toBe('admin-999');
      expect(service.resolveDeadLetter).toHaveBeenCalledWith(
        'dlq-1',
        dto,
        'admin-999',
      );
    });
  });
});
