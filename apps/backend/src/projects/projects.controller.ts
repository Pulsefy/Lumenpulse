import {
  Controller,
  Get,
  Query,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import {
  ProjectListQueryDto,
  ProjectListResponseDto,
  ProjectDetailDto,
} from './dto/projects.dto';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get paginated list of projects with on-chain status',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved projects list',
    type: ProjectListResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error',
  })
  async listProjects(
    @Query() query: ProjectListQueryDto,
  ): Promise<ProjectListResponseDto> {
    return this.projectsService.listProjects(query);
  }

  @Get(':projectId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get detailed project information with on-chain state',
  })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    example: 'project_123',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved project details',
    type: ProjectDetailDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Project not found',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error',
  })
  async getProjectDetail(
    @Param('projectId') projectId: string,
  ): Promise<ProjectDetailDto> {
    return this.projectsService.getProjectDetail(projectId);
  }

  @Get(':projectId/health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check for project data availability' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    example: 'project_123',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Health check status',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        database: { type: 'boolean' },
        cache: { type: 'boolean' },
      },
    },
  })
  async healthCheck(): Promise<{
    status: string;
    database: boolean;
    cache: boolean;
  }> {
    return this.projectsService.healthCheck();
  }
}
