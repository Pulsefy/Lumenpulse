import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedSearch } from './saved-search.entity';
import {
  CreateSavedSearchDto,
  UpdateSavedSearchDto,
  SavedSearchResponseDto,
  SavedSearchListResponseDto,
} from './dto/saved-search.dto';

/**
 * Owns persistence and access control for saved searches.
 *
 * All methods are scoped to the authenticated `userId` so a user can
 * only read or mutate their own saved searches.
 */
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SavedSearch, SavedSearchDomain } from './entities/saved-search.entity';
import { CreateSavedSearchDto } from './dto/create-saved-search.dto';
import { UpdateSavedSearchDto } from './dto/update-saved-search.dto';
import { ListSavedSearchesQueryDto } from './dto/saved-search-response.dto';
import { NotificationService } from '../notification/notification.service';
import {
  NotificationType,
  NotificationSeverity,
} from '../notification/notification.entity';

/** Maximum saved searches a single user may keep. */
const MAX_SAVED_SEARCHES_PER_USER = 100;

@Injectable()
export class SavedSearchesService {
  private readonly logger = new Logger(SavedSearchesService.name);

  constructor(
    @InjectRepository(SavedSearch)
    private readonly repository: Repository<SavedSearch>,
  ) {}

  async list(userId: string): Promise<SavedSearchListResponseDto> {
    const items = await this.repository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return {
      items: items.map((item) => this.toResponseDto(item)),
      total: items.length,
    };
  }
    private readonly repo: Repository<SavedSearch>,
    private readonly notificationService: NotificationService,
  ) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async create(
    userId: string,
    dto: CreateSavedSearchDto,
  ): Promise<SavedSearchResponseDto> {
    this.logger.log(
      `Creating saved search "${dto.name}" for user ${userId}`,
    );

    // Enforce a unique name per user so the UI can identify searches by label.
    const existing = await this.repository.findOne({
      where: { userId, name: dto.name },
    });
    if (existing) {
      throw new ConflictException(
        `You already have a saved search named "${dto.name}"`,
      );
    }

    const saved = await this.repository.save(
      this.repository.create({
        userId,
        name: dto.name,
        query: (dto.query ?? '').trim(),
        filters: dto.filters ?? {},
        notificationsEnabled: dto.notificationsEnabled ?? false,
      } as Partial<SavedSearch>),
    );

    return this.toResponseDto(saved);
  }

  async update(
    userId: string,
    searchId: string,
    dto: UpdateSavedSearchDto,
  ): Promise<SavedSearchResponseDto> {
    const item = await this.repository.findOne({
      where: { id: searchId, userId },
    });

    if (!item) {
      throw new NotFoundException(
        `Saved search ${searchId} not found`,
      );
    }

    // When renaming, keep the per-user unique-name invariant intact.
    if (dto.name !== undefined && dto.name !== item.name) {
      const conflicting = await this.repository.findOne({
        where: { userId, name: dto.name },
      });
      if (conflicting && conflicting.id !== item.id) {
        throw new ConflictException(
          `You already have a saved search named "${dto.name}"`,
        );
      }
      item.name = dto.name;
    }

    if (dto.query !== undefined) item.query = dto.query.trim();
    if (dto.filters !== undefined) item.filters = dto.filters;
    if (dto.notificationsEnabled !== undefined) {
      item.notificationsEnabled = dto.notificationsEnabled;
    }

    const saved = await this.repository.save(item);
    return this.toResponseDto(saved);
  }

  async remove(userId: string, searchId: string): Promise<void> {
    const item = await this.repository.findOne({
      where: { id: searchId, userId },
    });

    if (!item) {
      throw new NotFoundException(
        `Saved search ${searchId} not found`,
      );
    }

    await this.repository.remove(item);
  }

  /**
   * Convenience method for the notification toggle control — flips the
   * boolean flag and returns the updated search.
   */
  async setNotificationsEnabled(
    userId: string,
    searchId: string,
    enabled: boolean,
  ): Promise<SavedSearchResponseDto> {
    return this.update(userId, searchId, { notificationsEnabled: enabled });
  }

  private toResponseDto(item: SavedSearch): SavedSearchResponseDto {
    return {
      id: item.id,
      userId: item.userId,
      name: item.name,
      query: item.query,
      filters: item.filters,
      notificationsEnabled: item.notificationsEnabled,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  ): Promise<SavedSearch> {
    const count = await this.repo.count({ where: { userId } });

    if (count >= MAX_SAVED_SEARCHES_PER_USER) {
      throw new ForbiddenException(
        `You have reached the maximum of ${MAX_SAVED_SEARCHES_PER_USER} saved searches.`,
      );
    }

    const entity = this.repo.create({
      userId,
      name: dto.name,
      domain: dto.domain,
      filters: dto.filters,
      isSubscribed: dto.isSubscribed ?? false,
      lastNotifiedAt: null,
    });

    const saved = await this.repo.save(entity);
    this.logger.log(
      `Saved search created: id=${saved.id} domain=${saved.domain} user=${userId}`,
    );

    if (saved.isSubscribed) {
      await this.emitSubscriptionConfirmation(userId, saved);
    }

    return saved;
  }

  // ── List ───────────────────────────────────────────────────────────────────

  async findAll(
    userId: string,
    query: ListSavedSearchesQueryDto,
  ): Promise<{ items: SavedSearch[]; total: number }> {
    const where: Record<string, unknown> = { userId };
    if (query.domain) {
      where['domain'] = query.domain;
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
    });

    return { items, total };
  }

  // ── Get one ────────────────────────────────────────────────────────────────

  async findOne(userId: string, id: string): Promise<SavedSearch> {
    const entity = await this.repo.findOne({ where: { id, userId } });
    if (!entity) {
      throw new NotFoundException(`Saved search ${id} not found`);
    }
    return entity;
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  async update(
    userId: string,
    id: string,
    dto: UpdateSavedSearchDto,
  ): Promise<SavedSearch> {
    const entity = await this.findOne(userId, id);

    const wasSubscribed = entity.isSubscribed;

    if (dto.name !== undefined) entity.name = dto.name;
    if (dto.domain !== undefined) entity.domain = dto.domain;
    if (dto.filters !== undefined) entity.filters = dto.filters;
    if (dto.isSubscribed !== undefined) entity.isSubscribed = dto.isSubscribed;

    const updated = await this.repo.save(entity);

    // Emit a notification when the user newly enables subscription.
    if (!wasSubscribed && updated.isSubscribed) {
      await this.emitSubscriptionConfirmation(userId, updated);
    }

    this.logger.log(`Saved search updated: id=${id} user=${userId}`);
    return updated;
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async remove(userId: string, id: string): Promise<void> {
    const entity = await this.findOne(userId, id);
    await this.repo.remove(entity);
    this.logger.log(`Saved search deleted: id=${id} user=${userId}`);
  }

  // ── Subscription dispatch (called by the scheduler) ────────────────────────

  /**
   * Returns all searches that have subscriptions enabled.
   * The scheduler uses this to fan out "new results" notifications.
   */
  async findAllSubscribed(): Promise<SavedSearch[]> {
    return this.repo.find({ where: { isSubscribed: true } });
  }

  /**
   * Called by the notification job after it has dispatched alerts for a search.
   * Records the timestamp so the next run can compute a "new since last check"
   * diff without re-notifying for the same items.
   */
  async markNotified(id: string): Promise<void> {
    await this.repo.update(id, { lastNotifiedAt: new Date() });
  }

  /**
   * Dispatch a notification informing the user that new results are available
   * for a subscribed search.  The caller is responsible for determining whether
   * results are actually new (comparing against `lastNotifiedAt`).
   */
  async dispatchNewResultsNotification(
    search: SavedSearch,
    newResultCount: number,
  ): Promise<void> {
    const domainLabel = this.domainLabel(search.domain);

    await this.notificationService.create({
      userId: search.userId,
      type: this.domainToNotificationType(search.domain),
      severity: NotificationSeverity.LOW,
      title: `New ${domainLabel} results for "${search.name}"`,
      message:
        `${newResultCount} new ${domainLabel} result${newResultCount !== 1 ? 's' : ''} ` +
        `match your saved search "${search.name}".`,
      metadata: {
        savedSearchId: search.id,
        domain: search.domain,
        filters: search.filters,
        newResultCount,
      },
    });

    await this.markNotified(search.id);

    this.logger.log(
      `Notification dispatched for saved search id=${search.id} newResults=${newResultCount}`,
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async emitSubscriptionConfirmation(
    userId: string,
    search: SavedSearch,
  ): Promise<void> {
    const domainLabel = this.domainLabel(search.domain);
    await this.notificationService.create({
      userId,
      type: this.domainToNotificationType(search.domain),
      severity: NotificationSeverity.LOW,
      title: `Subscribed to "${search.name}"`,
      message: `You will be notified when new ${domainLabel} results match your saved search.`,
      metadata: {
        savedSearchId: search.id,
        domain: search.domain,
      },
    });
  }

  private domainToNotificationType(
    domain: SavedSearchDomain,
  ): NotificationType {
    switch (domain) {
      case SavedSearchDomain.GRANTS:
        return NotificationType.PROJECT;
      case SavedSearchDomain.PROJECTS:
        return NotificationType.PROJECT;
      case SavedSearchDomain.NEWS:
        return NotificationType.SYSTEM;
    }
  }

  private domainLabel(domain: SavedSearchDomain): string {
    switch (domain) {
      case SavedSearchDomain.GRANTS:
        return 'grants';
      case SavedSearchDomain.PROJECTS:
        return 'project';
      case SavedSearchDomain.NEWS:
        return 'news';
    }
  }
}
