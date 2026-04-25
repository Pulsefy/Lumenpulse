import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WatchlistItem, WatchlistItemType } from './watchlist-item.entity';
import {
  AddToWatchlistDto,
  UpdateWatchlistDto,
  WatchlistItemResponseDto,
  WatchlistResponseDto,
} from './dto/watchlist.dto';

@Injectable()
export class WatchlistService {
  private readonly logger = new Logger(WatchlistService.name);

  constructor(
    @InjectRepository(WatchlistItem)
    private readonly watchlistRepository: Repository<WatchlistItem>,
  ) {}

  /**
   * Add an item to the user's watchlist
   */
  async addItem(
    userId: string,
    dto: AddToWatchlistDto,
  ): Promise<WatchlistItemResponseDto> {
    this.logger.log(`Adding ${dto.symbol} to watchlist for user ${userId}`);

    // Check for duplicate
    const existing = await this.watchlistRepository.findOne({
      where: {
        userId,
        symbol: dto.symbol,
        type: dto.type,
      },
    });

    if (existing) {
      throw new ConflictException(`${dto.symbol} is already in your watchlist`);
    }

    const item = this.watchlistRepository.create({
      userId,
      symbol: dto.symbol.toUpperCase(),
      name: dto.name || null,
      type: dto.type,
      assetIssuer: dto.assetIssuer || null,
      imageUrl: dto.imageUrl || null,
      notes: dto.notes || null,
      sortOrder: dto.sortOrder ?? 0,
    } as Partial<WatchlistItem>);

    const saved = await this.watchlistRepository.save(item);
    return this.toResponseDto(saved);
  }

  /**
   * Remove an item from the user's watchlist
   */
  async removeItem(userId: string, itemId: string): Promise<void> {
    this.logger.log(
      `Removing item ${itemId} from watchlist for user ${userId}`,
    );

    const item = await this.watchlistRepository.findOne({
      where: { id: itemId, userId },
    });

    if (!item) {
      throw new NotFoundException(`Watchlist item ${itemId} not found`);
    }

    await this.watchlistRepository.remove(item);
  }

  /**
   * Get all watchlist items for a user
   */
  async getWatchlist(
    userId: string,
    type?: WatchlistItemType,
  ): Promise<WatchlistResponseDto> {
    this.logger.log(`Fetching watchlist for user ${userId}`);

    const where: Record<string, unknown> = { userId };
    if (type) {
      where.type = type;
    }

    const [items, total] = await this.watchlistRepository.findAndCount({
      where,
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
    });

    return {
      items: items.map((item) => this.toResponseDto(item)),
      total,
    };
  }

  /**
   * Update a watchlist item
   */
  async updateItem(
    userId: string,
    itemId: string,
    dto: UpdateWatchlistDto,
  ): Promise<WatchlistItemResponseDto> {
    this.logger.log(`Updating watchlist item ${itemId} for user ${userId}`);

    const item = await this.watchlistRepository.findOne({
      where: { id: itemId, userId },
    });

    if (!item) {
      throw new NotFoundException(`Watchlist item ${itemId} not found`);
    }

    if (dto.name !== undefined) item.name = dto.name;
    if (dto.imageUrl !== undefined) item.imageUrl = dto.imageUrl;
    if (dto.notes !== undefined) item.notes = dto.notes;
    if (dto.sortOrder !== undefined) item.sortOrder = dto.sortOrder;

    const saved = await this.watchlistRepository.save(item);
    return this.toResponseDto(saved);
  }

  /**
   * Check if a symbol is in the user's watchlist
   */
  async isSymbolInWatchlist(
    userId: string,
    symbol: string,
    type?: WatchlistItemType,
  ): Promise<boolean> {
    const where: Record<string, unknown> = {
      userId,
      symbol: symbol.toUpperCase(),
    };
    if (type) {
      where.type = type;
    }

    const count = await this.watchlistRepository.count({ where });
    return count > 0;
  }

  /**
   * Reorder watchlist items
   */
  async reorderItems(
    userId: string,
    itemIds: string[],
  ): Promise<WatchlistResponseDto> {
    this.logger.log(`Reordering watchlist for user ${userId}`);

    // Update sortOrder for each item
    await Promise.all(
      itemIds.map(async (itemId, index) => {
        const item = await this.watchlistRepository.findOne({
          where: { id: itemId, userId },
        });
        if (item) {
          item.sortOrder = index;
          await this.watchlistRepository.save(item);
        }
      }),
    );

    return this.getWatchlist(userId);
  }

  /**
   * Toggle a symbol in the watchlist (add if not present, remove if present)
   */
  async toggleItem(
    userId: string,
    dto: AddToWatchlistDto,
  ): Promise<{ added: boolean; item?: WatchlistItemResponseDto }> {
    const existing = await this.watchlistRepository.findOne({
      where: {
        userId,
        symbol: dto.symbol.toUpperCase(),
        type: dto.type,
      },
    });

    if (existing) {
      await this.watchlistRepository.remove(existing);
      return { added: false };
    }

    const item = await this.addItem(userId, dto);
    return { added: true, item };
  }

  private toResponseDto(item: WatchlistItem): WatchlistItemResponseDto {
    return {
      id: item.id,
      userId: item.userId,
      symbol: item.symbol,
      name: item.name,
      type: item.type,
      assetIssuer: item.assetIssuer,
      imageUrl: item.imageUrl,
      notes: item.notes,
      sortOrder: item.sortOrder,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
