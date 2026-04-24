import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import {
  ModelRetrainingService,
  RetrainResult,
  ModelStatusResult,
} from './model-retraining.service';

class TriggerRetrainDto {
  force?: boolean;
}

/**
 * Admin-only endpoints for model retraining management.
 * All routes require JWT + ADMIN role.
 */
@Controller('admin/models')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ModelRetrainingController {
  constructor(private readonly retrainingService: ModelRetrainingService) {}

  /**
   * POST /admin/models/retrain
   * Trigger an immediate model retraining run.
   * Body: { force?: boolean }
   */
  @Post('retrain')
  @HttpCode(HttpStatus.OK)
  async triggerRetrain(
    @Body() body: TriggerRetrainDto,
  ): Promise<RetrainResult> {
    return this.retrainingService.triggerRetraining(body.force ?? false);
  }

  /**
   * GET /admin/models/status
   * Return current model registry state and last retraining run metadata.
   */
  @Get('status')
  async getStatus(): Promise<ModelStatusResult> {
    return this.retrainingService.getModelStatus();
  }
}
