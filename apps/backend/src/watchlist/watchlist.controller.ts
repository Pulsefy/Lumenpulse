import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { WatchlistService } from './watchlist.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AddToWatchlistDto,
  UpdateWatchlistDto,
  WatchlistItemResponseDto,
  WatchlistResponseDto,
} from './dto/watchlist.dto';
import { WatchlistItemType } from './watchlist-item.entity';
import { getWatchlistReadThrottleOverride, getWatchlistWriteThrottleOverride } from '../common/rate-limit/rate-limit.config';

@ApiTags('watchlist')
@ApiBearerAuth('JWT-auth')
@Controller('watchlist')
@UseGuards(JwtAuthGuard)
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Get()
  @Throttle(getWatchlistReadThrottleOverride())
  @ApiOperation({
    summary: 'Get user watchlist',
    description:
      'Returns all items in the authenticated user\'s watchlist, optionally filtered by type',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: WatchlistItemType,
    description: 'Filter by item type (asset or project)',
  })
  @ApiResponse({
    status: 200,
    description: 'Watchlist retrieved successfully',
    type: WatchlistResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getWatchlist(
    @Request() req: any,
    @Query('type') type?: WatchlistItemType,
  ): Promise<WatchlistResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.watchlistService.getWatchlist(userId, type);
  }

  @Post()
  @Throttle(getWatchlistWriteThrottleOverride())
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add item to watchlist',
    description:
      'Add an asset or project to the authenticated user\'s watchlist',
  })
  @ApiResponse({
    status: 201,
    description: 'Item added to watchlist',
    type: WatchlistItemResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Item already in watchlist' })
  async addItem(
    @Request() req: any,
    @Body() dto: AddToWatchlistDto,
  ): Promise<WatchlistItemResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.watchlistService.addItem(userId, dto);
  }

  @Post('toggle')
  @Throttle(getWatchlistWriteThrottleOverride())
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle watchlist item',
    description:
      'Add or remove an item from the watchlist. Returns whether the item was added or removed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Toggle result',
    schema: {
      properties: {
        added: { type: 'boolean', example: true },
        item: { $ref: '#/components/schemas/WatchlistItemResponseDto' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async toggleItem(
    @Request() req: any,
    @Body() dto: AddToWatchlistDto,
  ): Promise<{ added: boolean; item?: WatchlistItemResponseDto }> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.watchlistService.toggleItem(userId, dto);
  }

  @Patch(':id')
  @Throttle(getWatchlistWriteThrottleOverride())
  @ApiOperation({
    summary: 'Update watchlist item',
    description:
      'Update a watchlist item\'s notes, image, name, or sort order',
  })
  @ApiResponse({
    status: 200,
    description: 'Item updated successfully',
    type: WatchlistItemResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  async updateItem(
    @Request() req: any,
    @Param('id') itemId: string,
    @Body() dto: UpdateWatchlistDto,
  ): Promise<WatchlistItemResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.watchlistService.updateItem(userId, itemId, dto);
  }

  @Delete(':id')
  @Throttle(getWatchlistWriteThrottleOverride())
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove item from watchlist',
    description:
      'Remove an asset or project from the authenticated user\'s watchlist',
  })
  @ApiResponse({ status: 204, description: 'Item removed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  async removeItem(
    @Request() req: any,
    @Param('id') itemId: string,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.watchlistService.removeItem(userId, itemId);
  }

  @Patch('reorder')
  @Throttle(getWatchlistWriteThrottleOverride())
  @ApiOperation({
    summary: 'Reorder watchlist items',
    description:
      'Reorder watchlist items by providing an array of item IDs in the desired order',
  })
  @ApiResponse({
    status: 200,
    description: 'Items reordered successfully',
    type: WatchlistResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async reorderItems(
    @Request() req: any,
    @Body() body: { itemIds: string[] },
  ): Promise<WatchlistResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.watchlistService.reorderItems(userId, body.itemIds);
  }

  @Get('check')
  @Throttle(getWatchlistReadThrottleOverride())
  @ApiOperation({
    summary: 'Check if symbol is in watchlist',
    description:
      'Check whether a specific symbol is in the authenticated user\'s watchlist',
  })
  @ApiQuery({ name: 'symbol', required: true, type: String })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: WatchlistItemType,
  })
  @ApiResponse({
    status: 200,
    description: 'Check result',
    schema: {
      properties: {
        inWatchlist: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async checkSymbol(
    @Request() req: any,
    @Query('symbol') symbol: string,
    @Query('type') type?: WatchlistItemType,
  ): Promise<{ inWatchlist: boolean }> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    const inWatchlist = await this.watchlistService.isSymbolInWatchlist(
      userId,
      symbol,
      type,
    );
    return { inWatchlist };
  }
}
