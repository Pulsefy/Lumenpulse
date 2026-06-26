import {
  Controller,
  Get,
  Post,
  Param,
  NotFoundException,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationJob } from './entities/reconciliation-job.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('reconciliation')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Manually trigger a reconciliation job (admin only)',
  })
  @ApiResponse({
    status: 202,
    description: 'Reconciliation job started',
    type: ReconciliationJob,
  })
  async triggerReconciliation(): Promise<ReconciliationJob> {
    return this.reconciliationService.runReconciliation('manual');
  }

  @Get('jobs')
  @ApiOperation({ summary: 'List recent reconciliation jobs (admin only)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'List of reconciliation jobs',
    type: [ReconciliationJob],
  })
  async listJobs(@Query('limit') limit?: number): Promise<ReconciliationJob[]> {
    return this.reconciliationService.getRecentJobs(limit ? Number(limit) : 20);
  }

  @Get('jobs/:id')
  @ApiOperation({
    summary: 'Get a specific reconciliation job by ID (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Reconciliation job details',
    type: ReconciliationJob,
  })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJob(@Param('id') id: string): Promise<ReconciliationJob> {
    const job = await this.reconciliationService.getJobById(id);
    if (!job) throw new NotFoundException(`Reconciliation job ${id} not found`);
    return job;
  }
}
