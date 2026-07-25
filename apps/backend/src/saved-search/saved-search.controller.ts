import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SavedSearchService } from './saved-search.service';
import { CreateSavedSearchDto, SavedSearchResponseDto } from './dto/saved-search.dto';

@ApiTags('saved-searches')
@ApiBearerAuth('JWT-auth')
@Controller('saved-searches')
@UseGuards(JwtAuthGuard)
export class SavedSearchController {
  constructor(private readonly savedSearchService: SavedSearchService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Save a discovery search query',
    description: 'Save a search query/filters and subscribe to downstream notifications.',
  })
  @ApiResponse({
    status: 201,
    description: 'Saved search created successfully',
    type: SavedSearchResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @Request() req: any,
    @Body() dto: CreateSavedSearchDto,
  ): Promise<SavedSearchResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.savedSearchService.create(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List user saved searches',
    description: 'Returns all saved searches and subscriptions for the authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of saved searches retrieved successfully',
    type: [SavedSearchResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(@Request() req: any): Promise<SavedSearchResponseDto[]> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.savedSearchService.findAll(userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a saved search',
    description: 'Remove a saved search and unsubscribe from its notifications.',
  })
  @ApiResponse({ status: 204, description: 'Saved search deleted successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Saved search not found' })
  async delete(@Request() req: any, @Param('id') id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const userId = req.user.sub as string;
    return this.savedSearchService.delete(userId, id);
  }
}
