import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { FeatureFlagsService } from './feature-flags.service';
import {
  UpsertFeatureFlagDto,
  FeatureFlagResponseDto,
  FlagAuditLogResponseDto,
  FlagEvaluationResponseDto,
} from './dto/feature-flag.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';

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
    description:
      'Determine whether a specific feature key is active. Pass `principalId` to ' +
      'have percentage and list targeting applied for that principal; without it ' +
      "the flag's plain on/off state is returned.",
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
  async check(
    @Param('key') key: string,
    @Query('principalId') principalId?: string,
  ) {
    if (principalId) {
      const { enabled } = await this.flags.evaluate(key, principalId);
      return { key, enabled };
    }
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

  /**
   * Admin endpoint — explain the evaluation a specific principal receives.
   *
   * Returns the boolean decision together with the reason and the stable hash
   * bucket the principal landed in, which is what makes a canary debuggable:
   * an operator can tell "outside the 5% bucket" apart from "suppressed by the
   * deny list" or "flag does not exist".
   */
  @Get(':key/evaluate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Evaluate a flag for one principal (admin only)',
    description:
      'Resolve a feature flag for a specific principal and report the result, ' +
      "the rule that produced it, and the principal's stable hash bucket. " +
      'Requires admin role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Flag evaluated successfully',
    type: FlagEvaluationResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  evaluate(
    @Param('key') key: string,
    @Query('principalId') principalId: string,
  ) {
    return this.flags.evaluate(key, principalId);
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
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create or update feature flag configuration (admin only)',
    description:
      'Creates a new feature flag or modifies the active state of an existing one, ' +
      'including its rollout percentage and allow/deny lists. Omitting the ' +
      'targeting fields leaves any existing rollout untouched. Requires admin role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature flag upserted successfully',
    type: FeatureFlagResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  upsert(@Body() body: UpsertFeatureFlagDto) {
    // Only forward targeting when at least one field was supplied, so an
    // on/off-only update cannot silently clear a live rollout.
    const targeting =
      body.rolloutPercentage !== undefined ||
      body.allowList !== undefined ||
      body.denyList !== undefined
        ? {
            rolloutPercentage: body.rolloutPercentage,
            allowList: body.allowList,
            denyList: body.denyList,
          }
        : undefined;

    return this.flags.upsert(
      body.key,
      body.enabled,
      body.conditions ?? undefined,
      body.changedBy,
      targeting,
    );
  }

  @Delete(':key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Delete feature flag (admin only)',
    description:
      'Removes a feature flag from the system configuration. Requires admin role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Feature flag deleted successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  @ApiResponse({ status: 404, description: 'Feature flag not found' })
  remove(@Param('key') key: string) {
    return this.flags.remove(key);
  }
}
