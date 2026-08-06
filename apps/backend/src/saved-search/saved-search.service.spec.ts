import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { SavedSearchService } from './saved-search.service';
import { SavedSearch, SavedSearchDomain } from './saved-search.entity';
import { NotificationService } from '../notification/notification.service';
import {
  NotificationType,
  NotificationSeverity,
} from '../notification/notification.entity';

describe('SavedSearchService', () => {
  let service: SavedSearchService;
  let savedSearchRepo: Pick<
    Repository<SavedSearch>,
    'create' | 'save' | 'find' | 'findOne' | 'remove'
  >;
  let notificationService: Pick<Repository<any>, 'create'>;

  beforeEach(async () => {
    savedSearchRepo = {
      create: jest
        .fn()
        .mockImplementation(
          (dto: DeepPartial<SavedSearch>) => dto as SavedSearch,
        ),
      save: jest
        .fn()
        .mockImplementation((entity: SavedSearch) =>
          Promise.resolve({ id: 'mock-id', ...entity }),
        ),
      find: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
    };

    notificationService = {
      create: jest.fn().mockResolvedValue({ id: 'mock-notif-id' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SavedSearchService,
        { provide: getRepositoryToken(SavedSearch), useValue: savedSearchRepo },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get(SavedSearchService);
  });

  describe('create', () => {
    it('creates a saved search subscription successfully', async () => {
      const dto = {
        name: 'My test search',
        domain: SavedSearchDomain.PROJECTS,
        query: { q: 'stellar' },
        isSubscribed: true,
      };

      const result = await service.create('user-1', dto);
      expect(savedSearchRepo.create).toHaveBeenCalledWith({
        userId: 'user-1',
        name: dto.name,
        domain: dto.domain,
        query: dto.query,
        isSubscribed: true,
      });
      expect(result).toHaveProperty('id', 'mock-id');
      expect(result.name).toBe(dto.name);
    });
  });

  describe('handleNewItem', () => {
    it('sends notifications when a news article matches user saved searches', async () => {
      const activeSearches = [
        {
          id: 'search-1',
          userId: 'user-1',
          name: 'Stellar News',
          domain: SavedSearchDomain.NEWS,
          query: { q: 'stellar' },
          isSubscribed: true,
        },
        {
          id: 'search-2',
          userId: 'user-2',
          name: 'Ethereum News',
          domain: SavedSearchDomain.NEWS,
          query: { q: 'ethereum' },
          isSubscribed: true,
        },
      ];

      (savedSearchRepo.find as jest.Mock).mockResolvedValue(activeSearches);

      const article = {
        id: 'article-1',
        title: 'Exciting Stellar project launch',
        category: 'defi',
        tags: ['stellar', 'soroban'],
      };

      await service.handleNewItem(SavedSearchDomain.NEWS, article);

      // Only search-1 should match since title contains 'Stellar'
      expect(notificationService.create).toHaveBeenCalledTimes(1);
      expect(notificationService.create).toHaveBeenCalledWith({
        type: NotificationType.SAVED_SEARCH,
        title: 'New Article Match: Exciting Stellar project launch',
        message:
          'A new news article matching your saved search "Stellar News" has been published.',
        severity: NotificationSeverity.LOW,
        metadata: {
          domain: SavedSearchDomain.NEWS,
          savedSearchId: 'search-1',
          itemId: 'article-1',
        },
        userId: 'user-1',
      });
    });
  });
});
