import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { SavedSearchesService } from './saved-searches.service';
import { CreateSavedSearchDto } from './create-saved-search.dto';
import { SavedSearch } from './saved-search.entity';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';

export interface AuthenticatedRequest extends Request {
  user: {
    id?: string;
    sub?: string;
  };
}

@ApiTags('saved-searches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('saved-searches')
export class SavedSearchesController {
  constructor(private readonly savedSearchesService: SavedSearchesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a saved search',
    description: 'Creates a saved discovery query with optional subscription to updates',
  })
  @ApiResponse({
    status: 201,
    description: 'Saved search created successfully',
  })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateSavedSearchDto,
  ): Promise<SavedSearch> {
    const userId = (req.user.id || req.user.sub) as string;
    return this.savedSearchesService.create(userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List saved searches',
    description: 'Retrieves all saved searches for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'User saved searches',
  })
  async findAll(@Req() req: AuthenticatedRequest): Promise<SavedSearch[]> {
    const userId = (req.user.id || req.user.sub) as string;
    return this.savedSearchesService.findAllForUser(userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a saved search',
    description: 'Deletes a saved search by ID for the authenticated user',
  })
  @ApiParam({ name: 'id', description: 'Saved search ID' })
  @ApiResponse({ status: 204, description: 'Saved search deleted' })
  @ApiResponse({ status: 404, description: 'Saved search not found' })
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    const userId = (req.user.id || req.user.sub) as string;
    return this.savedSearchesService.remove(id, userId);
  }
}
