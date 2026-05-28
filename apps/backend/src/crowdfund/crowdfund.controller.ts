import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CrowdfundService } from './crowdfund.service';
import {
  ContributeDto,
  CreateProjectDto,
  CrowdfundProjectDto,
  ContributorDto,
  ContributionResponseDto,
} from './dto/crowdfund.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('crowdfund')
@Controller('crowdfund')
export class CrowdfundController {
  constructor(private readonly svc: CrowdfundService) {}

  // ── Projects ───────────────────────────────────────────────────────────────

  @Get('projects')
  @ApiOperation({
    summary: 'List all crowdfund projects',
    description: 'Retrieves a list of all active and inactive projects.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of projects retrieved successfully',
    type: [CrowdfundProjectDto],
  })
  listProjects() {
    return this.svc.listProjects();
  }

  @Get('projects/:id')
  @ApiOperation({
    summary: 'Get project details',
    description:
      'Retrieves detailed information of a single project by its ID.',
  })
  @ApiResponse({
    status: 200,
    description: 'Project details retrieved successfully',
    type: CrowdfundProjectDto,
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  getProject(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getProject(id);
  }

  @Post('projects')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create a new project',
    description: 'Creates a project listing. Requires authentication.',
  })
  @ApiResponse({
    status: 201,
    description: 'Project created successfully',
    type: CrowdfundProjectDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  createProject(@Body() dto: CreateProjectDto) {
    return this.svc.createProject(dto);
  }

  // ── Contributions ──────────────────────────────────────────────────────────

  @Post('contribute')
  @ApiOperation({
    summary: 'Contribute to a project',
    description: 'Submit a contribution transaction to support a project.',
  })
  @ApiResponse({
    status: 200,
    description: 'Contribution processed successfully',
    type: ContributionResponseDto,
  })
  contribute(@Body() dto: ContributeDto) {
    return this.svc.contribute(dto);
  }

  @Get('projects/:id/contributors')
  @ApiOperation({
    summary: 'Get project contributors',
    description:
      'Retrieve a list of contributors and their total contributions for a project.',
  })
  @ApiResponse({
    status: 200,
    description: 'Contributors list retrieved successfully',
    type: [ContributorDto],
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  getContributors(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getContributors(id);
  }

  @Get('projects/:id/balance')
  @ApiOperation({
    summary: 'Get project balance info',
    description:
      'Retrieve details about the current deposits, withdrawals, and balance.',
  })
  @ApiResponse({
    status: 200,
    description: 'Balance info retrieved successfully',
    schema: {
      properties: {
        totalDeposited: { type: 'string', example: '15000' },
        totalWithdrawn: { type: 'string', example: '0' },
        balance: { type: 'string', example: '15000' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Project not found' })
  getBalance(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getProjectBalance(id);
  }

  @Get('projects/:id/my-contributions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get my contributions to a project',
    description:
      'Retrieve all contributions made by a specific public key belonging to the user.',
  })
  @ApiResponse({
    status: 200,
    description: 'Contributions list retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  getMyContributions(
    @Param('id', ParseIntPipe) id: number,
    @Query('publicKey') publicKey: string,
  ) {
    return this.svc.getMyContributions(id, publicKey);
  }
}
