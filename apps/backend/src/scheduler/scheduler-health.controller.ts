import { Controller, Get, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  SchedulerHealthService,
  SchedulerJobStatus,
} from './scheduler-health.service';

interface SchedulerHealthPayload {
  status: 'ok' | 'error';
  summary: 'healthy' | 'stale-jobs';
  checkedAt: string;
  staleJobs: SchedulerJobStatus[];
  jobs: SchedulerJobStatus[];
}

@ApiTags('health')
@Controller('health/schedulers')
export class SchedulerHealthController {
  constructor(private readonly schedulerHealth: SchedulerHealthService) {}

  /**
   * Surfaces any scheduled job that has not succeeded within its expected
   * interval. Returns HTTP 200 when every registered job is healthy and
   * HTTP 503 as soon as any job is stale, so the endpoint can be wired
   * directly into load-balancer and uptime checks.
   */
  @Get()
  @ApiOperation({
    summary:
      'Reports last run times, outcomes, durations, and staleness of scheduled jobs',
    description:
      'Each registered scheduled job reports its last start, last success, ' +
      'last failure, and duration. Jobs that have not succeeded within their ' +
      'expected interval are marked stale and cause HTTP 503.',
  })
  @ApiOkResponse({
    description:
      'All scheduled jobs succeeded within their expected intervals.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'One or more scheduled jobs have not succeeded within their expected interval.',
  })
  async getSchedulerHealth(
    @Res({ passthrough: true }) response: Response,
  ): Promise<SchedulerHealthPayload> {
    const jobs = await this.schedulerHealth.getJobStatuses();
    const staleJobs = jobs.filter((job) => job.stale);

    response.status(staleJobs.length > 0 ? 503 : 200);

    return {
      status: staleJobs.length > 0 ? 'error' : 'ok',
      summary: staleJobs.length > 0 ? 'stale-jobs' : 'healthy',
      checkedAt: new Date().toISOString(),
      staleJobs,
      jobs,
    };
  }
}
