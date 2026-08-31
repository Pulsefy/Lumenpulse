import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OutboxService } from './outbox.service';
import { OutboxEvent, OutboxEventStatus } from './outbox-event.entity';
import { JobLockService } from '../scheduler/job-lock.service';
import { MetricsService } from '../metrics/metrics.service';

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOneBy: jest.fn(),
  findAndCount: jest.fn(),
  countBy: jest.fn(),
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
        {
          provide: JobLockService,
          useValue: {
            tryAcquire: jest.fn().mockResolvedValue(true),
            release: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            setOutboxRelayLagSeconds: jest.fn(),
            recordOutboxAttempt: jest.fn(),
            setOutboxDeadLetterVolume: jest.fn(),
          },
        },
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
          deadLetterAt: null,
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

    it('moves event to DEAD_LETTER after the configured attempt limit', async () => {
      const event: Partial<OutboxEvent> = {
        id: 'uuid-5',
        eventType: 'payment.failed',
        payload: {},
        status: OutboxEventStatus.PENDING,
        attempts: 4, // one more will hit the limit of 5
        lastError: 'previous error',
        processedAt: null,
        deadLetterAt: null,
      };

      repo.find.mockResolvedValue([event]);
      repo.save.mockResolvedValue(event);

      const handler = jest.fn().mockRejectedValue(new Error('still down'));
      service.registerHandler(handler);

      await service.pollAndDispatch();

      expect(event.status).toBe(OutboxEventStatus.DEAD_LETTER);
      expect(event.attempts).toBe(5);
      expect(event.deadLetterAt).toBeInstanceOf(Date);
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

  // ─── dead letter management ──────────────────────────────────────────────────

  describe('listDeadLetters()', () => {
    it('returns paginated dead-lettered events', async () => {
      const event = { id: 'dl-1' } as OutboxEvent;
      repo.findAndCount.mockResolvedValue([[event], 1]);

      const result = await service.listDeadLetters(0, 20);

      expect(repo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: OutboxEventStatus.DEAD_LETTER },
          skip: 0,
          take: 20,
        }),
      );
      expect(result).toEqual({
        data: [event],
        total: 1,
        page: 0,
        limit: 20,
        totalPages: 1,
      });
    });
  });

  describe('inspectDeadLetter()', () => {
    it('returns the event when it is dead-lettered', async () => {
      const event = {
        id: 'dl-1',
        status: OutboxEventStatus.DEAD_LETTER,
      } as OutboxEvent;
      repo.findOneBy.mockResolvedValue(event);

      await expect(service.inspectDeadLetter('dl-1')).resolves.toBe(event);
    });

    it('throws NotFound for a missing or non-dead-letter event', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.inspectDeadLetter('nope')).rejects.toThrow(
        'Dead-letter outbox event not found',
      );

      repo.findOneBy.mockResolvedValue({
        id: 'dl-2',
        status: OutboxEventStatus.PROCESSED,
      } as OutboxEvent);
      await expect(service.inspectDeadLetter('dl-2')).rejects.toThrow(
        'Dead-letter outbox event not found',
      );
    });
  });

  describe('replayDeadLetter()', () => {
    it('resets and dispatches a dead-lettered event to PROCESSED on success', async () => {
      const event = {
        id: 'dl-1',
        eventType: 'order.placed',
        payload: { orderId: '42' },
        status: OutboxEventStatus.DEAD_LETTER,
        attempts: 5,
        lastError: 'boom',
        processedAt: null,
        deadLetterAt: new Date(),
      } as OutboxEvent;

      repo.findOneBy.mockResolvedValue(event);
      repo.save.mockResolvedValue(event);
      service.registerHandler(jest.fn().mockResolvedValue(undefined));

      const result = await service.replayDeadLetter('dl-1');

      expect(event.status).toBe(OutboxEventStatus.PROCESSED);
      expect(event.attempts).toBe(1);
      expect(event.deadLetterAt).toBeNull();
      expect(event.lastError).toBeNull();
      expect(result).toBe(event);
    });

    it('returns the event to PENDING when the replay attempt fails', async () => {
      const event = {
        id: 'dl-2',
        eventType: 'order.placed',
        payload: { orderId: '42' },
        status: OutboxEventStatus.DEAD_LETTER,
        attempts: 5,
        lastError: 'boom',
        processedAt: null,
        deadLetterAt: new Date(),
      } as OutboxEvent;

      repo.findOneBy.mockResolvedValue(event);
      repo.save.mockResolvedValue(event);
      service.registerHandler(jest.fn().mockRejectedValue(new Error('again')));

      await service.replayDeadLetter('dl-2');

      expect(event.status).toBe(OutboxEventStatus.PENDING);
      expect(event.attempts).toBe(1);
      expect(event.lastError).toBe('again');
    });

    it('throws BadRequest when the event is not dead-lettered', async () => {
      repo.findOneBy.mockResolvedValue({
        id: 'dl-3',
        status: OutboxEventStatus.PROCESSED,
      } as OutboxEvent);

      await expect(service.replayDeadLetter('dl-3')).rejects.toThrow(
        'is not in the dead-letter queue',
      );
    });

    it('throws NotFound when the event does not exist', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.replayDeadLetter('missing')).rejects.toThrow(
        'Outbox event not found',
      );
    });
  });
});
