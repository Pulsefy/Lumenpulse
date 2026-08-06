import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedSearch, SavedSearchDomain } from './saved-search.entity';
import { CreateSavedSearchDto } from './dto/saved-search.dto';
import { NotificationService } from '../notification/notification.service';
import {
  NotificationType,
  NotificationSeverity,
} from '../notification/notification.entity';

export type SavedSearchItem = Record<string, unknown>;

@Injectable()
export class SavedSearchService {
  private readonly logger = new Logger(SavedSearchService.name);

  constructor(
    @InjectRepository(SavedSearch)
    private readonly savedSearchRepo: Repository<SavedSearch>,
    private readonly notificationService: NotificationService,
  ) {}

  async create(
    userId: string,
    dto: CreateSavedSearchDto,
  ): Promise<SavedSearch> {
    const savedSearch = this.savedSearchRepo.create({
      userId,
      name: dto.name,
      domain: dto.domain,
      query: dto.query,
      isSubscribed: dto.isSubscribed ?? true,
    });

    const saved = await this.savedSearchRepo.save(savedSearch);
    this.logger.log(`Saved search created: "${saved.name}" for user ${userId}`);
    return saved;
  }

  async findAll(userId: string): Promise<SavedSearch[]> {
    return this.savedSearchRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async delete(userId: string, id: string): Promise<void> {
    const search = await this.savedSearchRepo.findOne({
      where: { id, userId },
    });
    if (!search) {
      throw new NotFoundException(`Saved search with ID ${id} not found`);
    }
    await this.savedSearchRepo.remove(search);
    this.logger.log(`Saved search deleted: ${id}`);
  }

  /**
   * Matches a newly created or synchronized item against active user saved searches,
   * triggering downstream notification workflows.
   */
  async handleNewItem(
    domain: SavedSearchDomain,
    item: SavedSearchItem,
  ): Promise<void> {
    const activeSearches = await this.savedSearchRepo.find({
      where: { domain, isSubscribed: true },
    });

    this.logger.log(
      `Checking new item of domain [${domain}] against ${activeSearches.length} active subscriptions`,
    );

    for (const search of activeSearches) {
      if (this.matches(search.query, item, domain)) {
        try {
          const { title, message } = this.buildNotificationContent(
            search,
            item,
          );
          await this.notificationService.create({
            type: NotificationType.SAVED_SEARCH,
            title,
            message,
            severity: NotificationSeverity.LOW,
            metadata: {
              domain,
              savedSearchId: search.id,
              itemId: this.itemId(item),
            },
            userId: search.userId,
          });
          this.logger.log(
            `Triggered notification for user ${search.userId} on saved search "${search.name}"`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to create notification for user ${search.userId} on saved search ${search.id}:`,
            err,
          );
        }
      }
    }
  }

  private matches(
    query: Record<string, unknown>,
    item: SavedSearchItem,
    domain: SavedSearchDomain,
  ): boolean {
    if (!query || Object.keys(query).length === 0) {
      return true;
    }

    // 1. Text search ('q', 'text', 'name')
    const queryValue = query.q ?? query.text ?? query.name;
    const searchTerm =
      typeof queryValue === 'string' ? queryValue.trim().toLowerCase() : '';
    if (searchTerm) {
      let itemText = '';
      if (domain === SavedSearchDomain.PROJECTS) {
        itemText =
          `${this.stringValue(item.name)} ${this.stringValue(item.description)} ${this.stringValue(item.category)}`.toLowerCase();
      } else if (domain === SavedSearchDomain.GRANTS) {
        itemText =
          `${this.stringValue(item.name)} ${this.stringValue(item.tokenAddress)}`.toLowerCase();
      } else if (domain === SavedSearchDomain.NEWS) {
        const tagsStr = Array.isArray(item.tags)
          ? item.tags
              .filter((tag): tag is string => typeof tag === 'string')
              .join(' ')
          : '';
        itemText =
          `${this.stringValue(item.title)} ${this.stringValue(item.category)} ${tagsStr}`.toLowerCase();
      }

      if (!itemText.includes(searchTerm)) {
        return false;
      }
    }

    // 2. Exact filter matching (e.g. status, category, tokenAddress)
    for (const [key, value] of Object.entries(query)) {
      if (['q', 'text', 'name'].includes(key)) {
        continue;
      }

      if (key in item) {
        const itemValue = item[key];
        if (Array.isArray(itemValue)) {
          if (Array.isArray(value)) {
            if (!value.every((v) => itemValue.includes(v))) return false;
          } else {
            if (!itemValue.includes(value)) return false;
          }
        } else if (typeof itemValue === 'string' && typeof value === 'string') {
          if (itemValue.toLowerCase() !== value.toLowerCase()) return false;
        } else {
          if (itemValue !== value) return false;
        }
      }
    }

    return true;
  }

  private buildNotificationContent(
    search: SavedSearch,
    item: SavedSearchItem,
  ): { title: string; message: string } {
    switch (search.domain) {
      case SavedSearchDomain.PROJECTS:
        return {
          title: `New Project Match: ${this.stringValue(item.name) || 'Unnamed Project'}`,
          message: `A new project matching your saved search "${search.name}" has been registered.`,
        };
      case SavedSearchDomain.GRANTS:
        return {
          title: `New Grant Round: ${this.stringValue(item.name) || 'Unnamed Round'}`,
          message: `A new grant round matching your saved search "${search.name}" is now active.`,
        };
      case SavedSearchDomain.NEWS:
        return {
          title: `New Article Match: ${this.stringValue(item.title) || 'Untitled Article'}`,
          message: `A new news article matching your saved search "${search.name}" has been published.`,
        };
      default:
        return {
          title: 'Saved Search Subscription Update',
          message: `A new item matching your saved search "${search.name}" has been detected.`,
        };
    }
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private itemId(item: SavedSearchItem): string {
    return this.stringValue(item.id) || this.stringValue(item.projectId);
  }
}
