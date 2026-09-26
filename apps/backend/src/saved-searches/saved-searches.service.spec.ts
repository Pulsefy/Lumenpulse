import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SavedSearchesService } from './saved-searches.service';
import {
  SavedSearch,
  SavedSearchDomain,
} from './entities/saved-search.entity';
import { NotificationService } from '../notification/notification.service';
import {
  NotificationType,
  NotificationSeverity,
} from '../notification/notification.entity';

// ── Helpers ────────────────────────────────────────────────────────────────────

function mockSearch(overrides: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id: 'search-uuid-1',
    userId: 'user-uuid-1',
    name: 'Test search',
    domain: SavedSearchDomain.GRANTS,
    filters: { keyword: 'DeFi' },
    isSubscribed: false,
    lastNotifiedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    user: {} as any,
    ...overrides,
  };
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('SavedSearchesService', () => {
  let service: SavedSearchesService;

  const mockRepo = {
    count: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
  };

  const mockNotificationService = {
    create: jest.fn().mockResolvedValue({}),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SavedSearchesService,
        { provide: getRepositoryToken(SavedSearch), useValue: mockRepo },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<SavedSearchesService>(SavedSearchesService);
  });

  // ── create ───────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('persists a new search and returns it', async () => {
      const dto = {
        name: 'My search',
        domain: SavedSearchDomain.GRANTS,
        filters: { keyword: 'DeFi' },
        isSubscribed: false,
      };
      const created = mockSearch({ name: dto.name, isSubscribed: false });

      mockRepo.count.mockResolvedValue(0);
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      const result = await service.create('user-uuid-1', dto);

      expect(result).toEqual(created);
      expect(mockRepo.count).toHaveBeenCalledWith({ where: { userId: 'user-uuid-1' } });
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-uuid-1', isSubscribed: false }),
      );
      expect(mockRepo.save).toHaveBeenCalledWith(created);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('sends a subscription-confirmation notification when isSubscribed=true', async () => {
      const dto = {
        name: 'Subscribed search',
        domain: SavedSearchDomain.GRANTS,
        filters: {},
        isSubscribed: true,
      };
      const created = mockSearch({ isSubscribed: true });

      mockRepo.count.mockResolvedValue(0);
      mockRepo.create.mockReturnValue(created);
      mockRepo.save.mockResolvedValue(created);

      await service.create('user-uuid-1', dto);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-uuid-1',
          type: NotificationType.PROJECT,
          severity: NotificationSeverity.LOW,
        }),
      );
    });

    it('throws ForbiddenException when the user has reached the 100-search limit', async () => {
      mockRepo.count.mockResolvedValue(100);

      await expect(
        service.create('user-uuid-1', {
          name: 'overflow',
          domain: SavedSearchDomain.PROJECTS,
          filters: {},
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── findAll ──────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns items and total', async () => {
      const items = [mockSearch()];
      mockRepo.findAndCount.mockResolvedValue([items, 1]);

      const result = await service.findAll('user-uuid-1', {});

      expect(result).toEqual({ items, total: 1 });
      expect(mockRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-uuid-1' } }),
      );
    });

    it('passes domain filter to the repository when provided', async () => {
      mockRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll('user-uuid-1', { domain: SavedSearchDomain.NEWS });

      expect(mockRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-uuid-1', domain: SavedSearchDomain.NEWS },
        }),
      );
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the search when it exists and belongs to the user', async () => {
      const search = mockSearch();
      mockRepo.findOne.mockResolvedValue(search);

      const result = await service.findOne('user-uuid-1', 'search-uuid-1');
      expect(result).toEqual(search);
    });

    it('throws NotFoundException when search does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findOne('user-uuid-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ───────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates fields and returns the saved entity', async () => {
      const existing = mockSearch({ isSubscribed: false });
      const saved = mockSearch({ name: 'Renamed', isSubscribed: false });

      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockResolvedValue(saved);

      const result = await service.update('user-uuid-1', 'search-uuid-1', {
        name: 'Renamed',
      });

      expect(result).toEqual(saved);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('fires a subscription-confirmation notification when toggling isSubscribed to true', async () => {
      const existing = mockSearch({ isSubscribed: false });
      const saved = mockSearch({ isSubscribed: true });

      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockResolvedValue(saved);

      await service.update('user-uuid-1', 'search-uuid-1', {
        isSubscribed: true,
      });

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-uuid-1',
          severity: NotificationSeverity.LOW,
        }),
      );
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('removes the entity from the repository', async () => {
      const search = mockSearch();
      mockRepo.findOne.mockResolvedValue(search);
      mockRepo.remove.mockResolvedValue(search);

      await service.remove('user-uuid-1', 'search-uuid-1');

      expect(mockRepo.remove).toHaveBeenCalledWith(search);
    });

    it('throws NotFoundException when the search does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.remove('user-uuid-1', 'ghost'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── findAllSubscribed ────────────────────────────────────────────────────────

  describe('findAllSubscribed', () => {
    it('queries only subscribed searches', async () => {
      mockRepo.find.mockResolvedValue([mockSearch({ isSubscribed: true })]);

      const result = await service.findAllSubscribed();

      expect(result).toHaveLength(1);
      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { isSubscribed: true },
      });
    });
  });

  // ── dispatchNewResultsNotification ───────────────────────────────────────────

  describe('dispatchNewResultsNotification', () => {
    it('creates a notification and marks the search as notified', async () => {
      const search = mockSearch({ isSubscribed: true });
      mockRepo.update.mockResolvedValue({});

      await service.dispatchNewResultsNotification(search, 3);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: search.userId,
          metadata: expect.objectContaining({
            savedSearchId: search.id,
            newResultCount: 3,
          }),
        }),
      );
      expect(mockRepo.update).toHaveBeenCalledWith(
        search.id,
        expect.objectContaining({ lastNotifiedAt: expect.any(Date) }),
      );
    });
  });
});
