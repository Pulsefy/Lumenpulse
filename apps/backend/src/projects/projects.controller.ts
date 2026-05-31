import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import {
  ProjectListQueryDto,
  ProjectListResponseDto,
  ProjectDetailDto,
} from './dto/projects.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List projects with on-chain state',
    description:
      'Retrieves a paginated list of projects with optional filtering. Includes on-chain status fields (active/expired, totals, etc.) by default.',
  })
  @ApiResponse({
    status: 200,
    description: 'Projects retrieved successfully',
    type: ProjectListResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async listProjects(
    @Query() query: ProjectListQueryDto,
  ): Promise<ProjectListResponseDto> {
    return this.projectsService.listProjects(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get project details with on-chain state',
    description:
      'Retrieves detailed information about a specific project including project registry and vault-derived state from the blockchain.',
  })
  @ApiParam({
    name: 'id',
    description: 'Project UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'Project details retrieved successfully',
    type: ProjectDetailDto,
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getProject(@Param('id') id: string): Promise<ProjectDetailDto> {
    return this.projectsService.getProject(id);
  }

  @Post(':id/sync')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sync on-chain state for a project',
    description:
      'Manually trigger a sync of on-chain state from the blockchain for a specific project. Requires authentication.',
  })
  @ApiParam({
    name: 'id',
    description: 'Project UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({
    status: 200,
    description: 'On-chain state synced successfully',
    schema: {
      properties: {
        success: { type: 'boolean', example: true },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async syncOnChainState(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.projectsService.syncOnChainState(id);
    return { success: true };
  }
}
