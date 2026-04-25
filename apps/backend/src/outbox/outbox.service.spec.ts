import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OutboxService } from './outbox.service';
import { OutboxEvent, OutboxEventStatus } from './outbox-event.entity';

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
});

type MockRepo = ReturnType<typeof mockRepo>;

describe('OutboxService', () => {
  let service: OutboxService;
  let repo: MockRepo;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxService,
        { provide: getRepositoryToken(OutboxEvent), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get<OutboxService>(OutboxService);
    repo = module.get<MockRepo>(getRepositoryToken(OutboxEvent));
  });

  afterEach(() => jest.clearAllMocks());

  // ─── publish ────────────────────────────────────────────────────────────────

  describe('publish()', () => {
    it('creates and saves a PENDING event', async () => {
      const built = { eventType: 'user.registered', payload: { userId: '1' } };
      const saved = {
        id: 'uuid-1',
        ...built,
        status: OutboxEventStatus.PENDING,
      };

      repo.create.mockReturnValue(built);
      repo.save.mockResolvedValue(saved);

      const result = await service.publish('user.registered', { userId: '1' });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'user.registered',
          payload: { userId: '1' },
          status: OutboxEventStatus.PENDING,
          attempts: 0,
          lastError: null,
          processedAt: null,
        }),
      );
      expect(repo.save).toHaveBeenCalledWith(built);
      expect(result).toBe(saved);
    });

    it('uses the provided EntityManager repository when given', async () => {
      const fakeManagerRepo = { create: jest.fn(), save: jest.fn() };
      const fakeManager = {
        getRepository: jest.fn().mockReturnValue(fakeManagerRepo),
      } as unknown as import('typeorm').EntityManager;

      const built = { eventType: 'test', payload: {} };
      fakeManagerRepo.create.mockReturnValue(built);
      fakeManagerRepo.save.mockResolvedValue({ id: 'uuid-2', ...built });

      await service.publish('test', {}, fakeManager);

      expect(fakeManager.getRepository).toHaveBeenCalledWith(OutboxEvent);
      expect(fakeManagerRepo.save).toHaveBeenCalled();
      // The default repo should NOT have been used
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  // ─── pollAndDispatch ─────────────────────────────────────────────────────────

  describe('pollAndDispatch()', () => {
    it('does nothing when there are no pending events', async () => {
      repo.find.mockResolvedValue([]);
      await service.pollAndDispatch();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('marks an event PROCESSED when all handlers succeed', async () => {
      const event: Partial<OutboxEvent> = {
        id: 'uuid-3',
        eventType: 'order.placed',
        payload: { orderId: '42' },
        status: OutboxEventStatus.PENDING,
        attempts: 0,
        lastError: null,
        processedAt: null,
      };

      repo.find.mockResolvedValue([event]);
      repo.save.mockResolvedValue(event);

      const handler = jest.fn().mockResolvedValue(undefined);
      service.registerHandler(handler);

      await service.pollAndDispatch();

      expect(handler).toHaveBeenCalledWith('order.placed', { orderId: '42' });
      expect(event.status).toBe(OutboxEventStatus.PROCESSED);
      expect(event.attempts).toBe(1);
      expect(event.processedAt).toBeInstanceOf(Date);
      expect(repo.save).toHaveBeenCalledWith(event);
    });

    it('keeps event PENDING and records error when a handler throws (below max attempts)', async () => {
      const event: Partial<OutboxEvent> = {
        id: 'uuid-4',
        eventType: 'payment.failed',
        payload: {},
        status: OutboxEventStatus.PENDING,
        attempts: 0,
        lastError: null,
        processedAt: null,
      };

      repo.find.mockResolvedValue([event]);
      repo.save.mockResolvedValue(event);

      const handler = jest.fn().mockRejectedValue(new Error('downstream down'));
      service.registerHandler(handler);

      await service.pollAndDispatch();

      expect(event.status).toBe(OutboxEventStatus.PENDING);
      expect(event.attempts).toBe(1);
      expect(event.lastError).toBe('downstream down');
    });

    it('marks event FAILED after MAX_ATTEMPTS', async () => {
      const event: Partial<OutboxEvent> = {
        id: 'uuid-5',
        eventType: 'payment.failed',
        payload: {},
        status: OutboxEventStatus.PENDING,
        attempts: 4, // one more will hit the limit of 5
        lastError: 'previous error',
        processedAt: null,
      };

      repo.find.mockResolvedValue([event]);
      repo.save.mockResolvedValue(event);

      const handler = jest.fn().mockRejectedValue(new Error('still down'));
      service.registerHandler(handler);

      await service.pollAndDispatch();

      expect(event.status).toBe(OutboxEventStatus.FAILED);
      expect(event.attempts).toBe(5);
    });

    it('dispatches to multiple registered handlers', async () => {
      const event: Partial<OutboxEvent> = {
        id: 'uuid-6',
        eventType: 'news.published',
        payload: { articleId: '99' },
        status: OutboxEventStatus.PENDING,
        attempts: 0,
        lastError: null,
        processedAt: null,
      };

      repo.find.mockResolvedValue([event]);
      repo.save.mockResolvedValue(event);

      const h1 = jest.fn().mockResolvedValue(undefined);
      const h2 = jest.fn().mockResolvedValue(undefined);
      service.registerHandler(h1);
      service.registerHandler(h2);

      await service.pollAndDispatch();

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
      expect(event.status).toBe(OutboxEventStatus.PROCESSED);
    });
  });
});
