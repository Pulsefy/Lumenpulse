import { Controller, Get, Query, Logger } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ContributorFeedService } from './contributor-feed.service';
import {
  ContributorFeedQueryDto,
  ContributorFeedResponseDto,
  FeedActivityType,
  FeedSortOrder,
} from './dto/contributor-feed.dto';

/**
 * ContributorFeedController
 *
 * Aggregated contributor activity feed combining multiple domains:
 *  - Contributor registration events
 *  - Grant contribution events
 *  - Reputation change events
 *
 * Supports pagination, stable ordering, filtering, and sparse contributor detection.
 */
@ApiTags('contributor-feed')
@Controller('contributor-feed')
export class ContributorFeedController {
  private readonly logger = new Logger(ContributorFeedController.name);

  constructor(private readonly svc: ContributorFeedService) {}

  @Get()
  @ApiOperation({
    summary: 'Get aggregated contributor activity feed',
    description:
      'Combines contributor registration, grant contribution, and reputation change ' +
      'events into a single paginated feed. Supports filtering by activity type and ' +
      'contributor address. Returns a flag for sparse/first-time contributors.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (1-indexed, default 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (1-100, default 20)',
  })
  @ApiQuery({
    name: 'activityType',
    required: false,
    enum: FeedActivityType,
    description: 'Filter by activity type',
  })
  @ApiQuery({
    name: 'contributorAddress',
    required: false,
    type: String,
    description: 'Filter by contributor Stellar address',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: FeedSortOrder,
    description: 'Sort order by timestamp (default DESC)',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated contributor activity feed',
    type: ContributorFeedResponseDto,
  })
  getFeed(@Query() query: ContributorFeedQueryDto): ContributorFeedResponseDto {
    return this.svc.getFeed(query);
  }
}
