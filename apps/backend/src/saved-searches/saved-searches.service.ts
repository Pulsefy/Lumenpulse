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
  }
}
