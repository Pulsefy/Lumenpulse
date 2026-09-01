import { Controller, Get, Param, Post, Body, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FeatureFlagsService } from './feature-flags.service';
import {
  UpsertFeatureFlagDto,
  FeatureFlagResponseDto,
  FlagAuditLogResponseDto,
} from './dto/feature-flag.dto';
import { ApiIdempotencyHeader } from '../common/decorators/api-idempotency.decorator';

@ApiTags('feature-flags')
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  @ApiOperation({
    summary: 'List all feature flags',
    description:
      'Retrieve a list of all defined feature flags and their current status.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of feature flags retrieved successfully',
    type: [FeatureFlagResponseDto],
  })
  list() {
    return this.flags.listFlags();
  }

  @Get('check/:key')
  @ApiOperation({
    summary: 'Check if a feature is enabled',
    description: 'Determine whether a specific feature key is active.',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature flag status checked successfully',
    schema: {
      properties: {
        key: { type: 'string', example: 'new-onboarding-flow' },
        enabled: { type: 'boolean', example: true },
      },
    },
  })
  async check(@Param('key') key: string) {
    const enabled = await this.flags.isEnabled(key);
    return { key, enabled };
  }

  /**
   * Admin endpoint — retrieve the full mutation history for a single flag.
   *
   * Returns all audit-log entries for the given key, newest-first.
   * Each entry captures the actor, the previous enabled state, the new
   * enabled state, and the timestamp.
   */
  @Get(':key/history')
  @ApiOperation({
    summary: 'Get flag change history (admin)',
    description:
      'Retrieve the full ordered audit log for a specific feature flag. ' +
      'Records include actor, previous state, new state, and timestamp.',
  })
  @ApiResponse({
    status: 200,
    description: 'Flag audit history retrieved successfully',
    type: [FlagAuditLogResponseDto],
  })
  history(@Param('key') key: string) {
    return this.flags.getFlagHistory(key);
  }

  @Get(':key')
  @ApiOperation({
    summary: 'Get details of a feature flag',
    description: 'Retrieves configuration details of a single feature flag.',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature flag configuration retrieved successfully',
    type: FeatureFlagResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Feature flag not found' })
  get(@Param('key') key: string) {
    return this.flags.getFlag(key);
  }

  @Post()
  @ApiIdempotencyHeader()
  @ApiOperation({
    summary: 'Create or update feature flag configuration',
    description:
      'Creates a new feature flag or modifies the active state of an existing one. ' +
      'NOTE: this endpoint currently has no authentication/authorization guard applied.',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature flag upserted successfully',
    type: FeatureFlagResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid feature flag payload' })
  upsert(@Body() body: UpsertFeatureFlagDto) {
    return this.flags.upsert(
      body.key,
      body.enabled,
      body.conditions ?? undefined,
      body.changedBy,
    );
  }

  @Delete(':key')
  @ApiIdempotencyHeader()
  @ApiOperation({
    summary: 'Delete feature flag',
    description:
      'Removes a feature flag from the system configuration. ' +
      'NOTE: this endpoint currently has no authentication/authorization guard applied.',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature flag deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Feature flag not found' })
  remove(@Param('key') key: string) {
    return this.flags.remove(key);
  }
}
