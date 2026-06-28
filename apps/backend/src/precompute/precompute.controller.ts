import {
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PrecomputeService } from './precompute.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('precompute')
@Controller('precompute')
export class PrecomputeController {
  constructor(private readonly precomputeService: PrecomputeService) {}

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually trigger cache refresh for all precompute tasks',
    description: 'Refreshes all cached responses. Skips tasks with unhealthy dependencies.',
  })
  @ApiResponse({
    status: 200,
    description: 'Precompute completed',
    schema: {
      example: {
        success: true,
        results: [
          {
            task: 'latest-news',
            success: true,
            durationMs: 1234,
            cached: true,
          },
        ],
        summary: {
          total: 3,
          successful: 2,
          skipped: 1,
          failed: 0,
          totalDurationMs: 3456,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async manualRefresh() {
    const results = await this.precomputeService.precomputeAll();

    const summary = {
      total: results.length,
      successful: results.filter((r) => r.success).length,
      skipped: results.filter((r) => r.skipped).length,
      failed: results.filter((r) => !r.success && !r.skipped).length,
      totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
    };

    return {
      success: true,
      results,
      summary,
    };
  }

  @Post('refresh/:taskName')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually trigger cache refresh for a specific task',
    description: 'Refreshes a specific cached response. Skips if dependencies are unhealthy.',
  })
  @ApiResponse({
    status: 200,
    description: 'Precompute task completed',
    schema: {
      example: {
        success: true,
        result: {
          task: 'latest-news',
          success: true,
          durationMs: 1234,
          cached: true,
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async refreshSpecific(@Param('taskName') taskName: string) {
    const result = await this.precomputeService.precomputeSpecific(taskName);

    return {
      success: result.success,
      result,
    };
  }

  @Get('tasks')
  @ApiOperation({
    summary: 'List available precompute tasks',
    description: 'Returns a list of all available precompute task names.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of available tasks',
    schema: {
      example: {
        tasks: ['latest-news', 'news-categories', 'stellar-assets'],
      },
    },
  })
  async listTasks() {
    return {
      tasks: this.precomputeService.getAvailableTasks(),
    };
  }

  @Get('status')
  @ApiOperation({
    summary: 'Get precompute status',
    description: 'Returns the current status of the precompute system.',
  })
  @ApiResponse({
    status: 200,
    description: 'Precompute status',
    schema: {
      example: {
        isPrecomputing: false,
        availableTasks: ['latest-news', 'news-categories', 'stellar-assets'],
      },
    },
  })
  async getStatus() {
    return {
      isPrecomputing: this.precomputeService.isPrecomputingActive(),
      availableTasks: this.precomputeService.getAvailableTasks(),
    };
  }
}
