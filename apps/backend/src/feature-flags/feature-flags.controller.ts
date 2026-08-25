import { Controller, Get, Param, Post, Body, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FeatureFlagsService } from './feature-flags.service';
import {
  UpsertFeatureFlagDto,
  FeatureFlagResponseDto,
} from './dto/feature-flag.dto';

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
  @ApiOperation({
    summary: 'Create or update feature flag configuration',
    description:
      'Creates a new feature flag or modifies the active state of an existing one.',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature flag upserted successfully',
    type: FeatureFlagResponseDto,
  })
  upsert(@Body() body: UpsertFeatureFlagDto) {
    return this.flags.upsert(
      body.key,
      body.enabled,
      body.conditions ?? undefined,
      body.changedBy,
    );
  }

  @Delete(':key')
  @ApiOperation({
    summary: 'Delete feature flag',
    description: 'Removes a feature flag from the system configuration.',
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
