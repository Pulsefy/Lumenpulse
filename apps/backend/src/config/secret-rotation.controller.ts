import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { SecretRotationTriggerGuard } from './secret-rotation-trigger.guard';
import { SecretRotationService } from './secret-rotation.service';
import type {
  RotatableSecretStatus,
  SecretRotationResult,
} from './secret-rotation.types';

/**
 * Operator/CI trigger for runtime secret rotation.
 *
 * Deliberately excluded from the published OpenAPI document (see
 * `SecretRotationTriggerGuard`) and documented instead in
 * `apps/backend/SECRET_ROTATION_RUNBOOK.md`.
 *
 *   GET  /v1/config/admin/secrets         → rotation status (no values)
 *   POST /v1/config/admin/secrets/rotate  → rotate one secret
 */
@ApiExcludeController()
@Controller({ path: 'config/admin/secrets', version: '1' })
@UseGuards(SecretRotationTriggerGuard)
export class SecretRotationController {
  constructor(private readonly secretRotationService: SecretRotationService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  getStatus(): { secrets: RotatableSecretStatus[] } {
    return { secrets: this.secretRotationService.getStatus() };
  }

  @Post('rotate')
  @HttpCode(HttpStatus.OK)
  async rotate(
    @Body() body: Record<string, unknown>,
    @Req() request: Request,
  ): Promise<{ message: string; rotation: SecretRotationResult }> {
    const parsed = this.secretRotationService.parseRotationRequest(body);
    const rotation = await this.secretRotationService.rotate(
      parsed.name,
      parsed.value,
      {
        actor: parsed.actor,
        ipAddress: getClientIp(request),
        reason: parsed.reason,
        overlapMs: parsed.overlapMs,
      },
    );

    return { message: `Secret ${rotation.name} rotated`, rotation };
  }
}

function getClientIp(request: Request): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return request.ip ?? request.socket?.remoteAddress ?? null;
}
