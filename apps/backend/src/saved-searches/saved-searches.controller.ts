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
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
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
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit.config';
import { SavedSearchesService } from './saved-searches.service';
import { CreateSavedSearchDto } from './dto/create-saved-search.dto';
import { UpdateSavedSearchDto } from './dto/update-saved-search.dto';
import {
  ListSavedSearchesQueryDto,
  SavedSearchResponseDto,
  SavedSearchListResponseDto,
} from './dto/saved-search-response.dto';

@ApiTags('saved-searches')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('saved-searches')
@RateLimitPolicy('projectRead')
export class SavedSearchesController {
  constructor(private readonly service: SavedSearchesService) {}

  // ── POST /saved-searches ───────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a saved search',
    description:
      'Saves the provided discovery query for the authenticated user.  ' +
      'Set `isSubscribed: true` to enrol the search in the notification ' +
      'workflow so the user is alerted when new results appear.',
  })
  @ApiResponse({
    status: 201,
    description: 'Saved search created successfully.',
    type: SavedSearchResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({
    status: 403,
    description: 'Saved search limit reached (max 100 per user).',
  })
  async create(
    @Request() req: any,
    @Body() dto: CreateSavedSearchDto,
  ): Promise<SavedSearchResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.service.create(userId, dto);
  }

  // ── GET /saved-searches ────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'List saved searches',
    description:
      'Returns all saved searches for the authenticated user, newest first.  ' +
      'Optionally filter by domain (`grants`, `projects`, or `news`).',
  })
  @ApiResponse({
    status: 200,
    description: 'List of saved searches.',
    type: SavedSearchListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async findAll(
    @Request() req: any,
    @Query() query: ListSavedSearchesQueryDto,
  ): Promise<SavedSearchListResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.service.findAll(userId, query);
  }

  // ── GET /saved-searches/:id ────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({
    summary: 'Get a saved search by ID',
    description:
      'Returns a single saved search owned by the authenticated user.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the saved search' })
  @ApiResponse({
    status: 200,
    description: 'Saved search details.',
    type: SavedSearchResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Saved search not found.' })
  async findOne(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SavedSearchResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.service.findOne(userId, id);
  }

  // ── PATCH /saved-searches/:id ──────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a saved search',
    description:
      'Partially update the name, domain, filters, or subscription status of a saved search.  ' +
      'Toggling `isSubscribed` from false to true triggers a subscription-confirmation notification.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the saved search' })
  @ApiResponse({
    status: 200,
    description: 'Saved search updated.',
    type: SavedSearchResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Saved search not found.' })
  async update(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
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
    return this.service.update(userId, id, dto);
  }

  // ── DELETE /saved-searches/:id ─────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a saved search',
    description:
      'Permanently removes the saved search.  Any active subscription is also cancelled.',
  })
  @ApiParam({ name: 'id', description: 'UUID of the saved search' })
  @ApiResponse({ status: 204, description: 'Saved search deleted.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'Saved search not found.' })
  async remove(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.service.remove(userId, id);
  }
}
