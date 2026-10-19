import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { SavedSearchesService } from './saved-searches.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateSavedSearchDto,
  UpdateSavedSearchDto,
  SavedSearchResponseDto,
  SavedSearchListResponseDto,
} from './dto/saved-search.dto';
import { getWatchlistReadThrottleOverride } from '../common/rate-limit/rate-limit.config';

/**
 * REST controller exposing saved-search CRUD plus a notification toggle.
 *
 * The controller mirrors the `watchlist` module's guard/throttle patterns so
 * behaviour is consistent for the UI and the rate-limit configuration.
 */
@ApiTags('saved-searches')
@ApiBearerAuth('JWT-auth')
@Controller('saved-searches')
@UseGuards(JwtAuthGuard)
export class SavedSearchesController {
  constructor(private readonly savedSearchesService: SavedSearchesService) {}

  @Get()
  @Throttle(getWatchlistReadThrottleOverride())
  @ApiOperation({
    summary: 'List saved searches',
    description:
      "Returns all saved searches belonging to the authenticated user",
  })
  @ApiResponse({
    status: 200,
    description: 'Saved searches retrieved successfully',
    type: SavedSearchListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async list(@Request() req: any): Promise<SavedSearchListResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.savedSearchesService.list(userId);
  }

  @Post()
  @Throttle(getWatchlistReadThrottleOverride())
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Save the current search',
    description:
      'Persist the current search query and filter snapshot under a name',
  })
  @ApiResponse({
    status: 201,
    description: 'Saved search created',
    type: SavedSearchResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'A saved search with that name already exists' })
  async create(
    @Request() req: any,
    @Body() dto: CreateSavedSearchDto,
  ): Promise<SavedSearchResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.savedSearchesService.create(userId, dto);
  }

  @Patch(':id')
  @Throttle(getWatchlistReadThrottleOverride())
  @ApiOperation({
    summary: 'Rename or update a saved search',
    description:
      'Update the name, query, filters or notification flag of a saved search',
  })
  @ApiResponse({
    status: 200,
    description: 'Saved search updated',
    type: SavedSearchResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Saved search not found' })
  @ApiResponse({ status: 409, description: 'Name conflicts with an existing saved search' })
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateSavedSearchDto,
  ): Promise<SavedSearchResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.savedSearchesService.update(userId, id, dto);
  }

  @Delete(':id')
  @Throttle(getWatchlistReadThrottleOverride())
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a saved search',
    description: 'Remove a saved search owned by the authenticated user',
  })
  @ApiResponse({ status: 204, description: 'Saved search deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Saved search not found' })
  async remove(
    @Request() req: any,
    @Param('id') id: string,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.savedSearchesService.remove(userId, id);
  }

  @Post(':id/notifications')
  @Throttle(getWatchlistReadThrottleOverride())
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Toggle notifications for a saved search',
    description:
      'Subscribe or unsubscribe from notifications when new results are available',
  })
  @ApiResponse({
    status: 200,
    description: 'Notification subscription updated',
    type: SavedSearchResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Saved search not found' })
  async setNotifications(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ): Promise<SavedSearchResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.savedSearchesService.setNotificationsEnabled(
      userId,
      id,
      body?.enabled === true,
    );
  }
}
