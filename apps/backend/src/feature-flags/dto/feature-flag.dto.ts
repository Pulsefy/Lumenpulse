import {
  IsString,
  IsBoolean,
  IsOptional,
  IsObject,
  IsInt,
  IsArray,
  ArrayMaxSize,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FLAG_EVALUATION_REASONS } from '../flag-targeting';

export class UpsertFeatureFlagDto {
  @ApiProperty({
    description: 'Unique feature flag key',
    example: 'new-onboarding-flow',
  })
  @IsString()
  key: string;

  @ApiProperty({
    description:
      'Whether the feature is enabled. Ignored while `rolloutPercentage` is set, ' +
      'since the percentage alone then decides the result.',
    example: true,
  })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({
    description:
      'Percentage (0-100) of principals to target, bucketed stably by principal ' +
      'ID so a user never flips between states. While set it fully replaces the ' +
      'plain on/off behaviour of `enabled`; 0 serves nobody and is therefore the ' +
      'kill switch. Send null to return to plain on/off.',
    minimum: 0,
    maximum: 100,
    example: 5,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  rolloutPercentage?: number;

  @ApiPropertyOptional({
    description:
      'Principal IDs always granted the flag, overriding `rolloutPercentage`.',
    type: [String],
    example: ['user-123', 'qa@lumenpulse.com'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  allowList?: string[];

  @ApiPropertyOptional({
    description:
      'Principal IDs always denied the flag. Overrides both `allowList` and ' +
      '`rolloutPercentage`, so it doubles as a per-user kill switch.',
    type: [String],
    example: ['user-456'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  denyList?: string[];

  @ApiPropertyOptional({
    description: 'Optional conditions (e.g. user roles, specific user IDs)',
    example: { roles: ['ADMIN'] },
  })
  @IsOptional()
  @IsObject()
  conditions?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Identifier of the user who changed this flag',
    example: 'admin@lumenpulse.com',
  })
  @IsOptional()
  @IsString()
  changedBy?: string;
}

export class FeatureFlagResponseDto {
  @ApiProperty({
    description: 'Unique feature flag key',
    example: 'new-onboarding-flow',
  })
  key: string;

  @ApiProperty({ description: 'Whether the feature is enabled', example: true })
  enabled: boolean;

  @ApiPropertyOptional({
    description:
      'Percentage (0-100) of principals targeted when above 0; null for plain on/off.',
    example: 5,
    nullable: true,
  })
  rolloutPercentage?: number | null;

  @ApiPropertyOptional({
    description: 'Principal IDs always granted the flag.',
    type: [String],
    example: ['user-123'],
  })
  allowList?: string[] | null;

  @ApiPropertyOptional({
    description: 'Principal IDs always denied the flag.',
    type: [String],
    example: ['user-456'],
  })
  denyList?: string[] | null;

  @ApiPropertyOptional({
    description: 'Optional conditions',
    example: { roles: ['ADMIN'] },
  })
  conditions?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Identifier of the user who last changed this flag',
    example: 'admin@lumenpulse.com',
  })
  changedBy?: string | null;
}

export class FlagEvaluationResponseDto {
  @ApiProperty({
    description: 'The feature-flag key that was evaluated',
    example: 'new-onboarding-flow',
  })
  key: string;

  @ApiProperty({
    description: 'The principal the flag was evaluated for',
    example: 'user-123',
    nullable: true,
  })
  principalId: string | null;

  @ApiProperty({
    description: 'Whether the flag is enabled for this principal',
    example: true,
  })
  enabled: boolean;

  @ApiProperty({
    description: 'The rule that produced this result',
    enum: FLAG_EVALUATION_REASONS,
    enumName: 'FlagEvaluationReason',
    example: 'percentage_included',
  })
  reason: string;

  @ApiPropertyOptional({
    description:
      "The principal's stable hash bucket in [0, 10000); null when no bucket was needed.",
    example: 412,
    nullable: true,
  })
  bucket: number | null;

  @ApiPropertyOptional({
    description: 'Rollout percentage configured on the flag',
    example: 5,
    nullable: true,
  })
  rolloutPercentage: number | null;

  @ApiPropertyOptional({
    description: 'Allow list configured on the flag',
    type: [String],
  })
  allowList: string[];

  @ApiPropertyOptional({
    description: 'Deny list configured on the flag',
    type: [String],
  })
  denyList: string[];
}

export class FlagAuditLogResponseDto {
  @ApiProperty({ description: 'Audit record ID (UUID)' })
  id: string;

  @ApiProperty({
    description: 'The feature-flag key that was mutated',
    example: 'new-onboarding-flow',
  })
  flagKey: string;

  @ApiProperty({
    description: "Action performed: 'upsert' | 'remove'",
    example: 'upsert',
  })
  action: 'upsert' | 'remove';

  @ApiPropertyOptional({
    description: "Flag's enabled state before this mutation (null if new flag)",
    example: false,
  })
  previousEnabled: boolean | null;

  @ApiPropertyOptional({
    description: "Flag's enabled state after this mutation (null for removals)",
    example: true,
  })
  newEnabled: boolean | null;

  @ApiPropertyOptional({
    description:
      'Targeting (rollout percentage, allow/deny lists) before this mutation; ' +
      'null if the flag did not exist',
    example: { rolloutPercentage: null, allowList: [], denyList: [] },
    nullable: true,
  })
  previousTargeting: Record<string, any> | null;

  @ApiPropertyOptional({
    description:
      'Targeting (rollout percentage, allow/deny lists) after this mutation; ' +
      'null for removals',
    example: { rolloutPercentage: 5, allowList: [], denyList: [] },
    nullable: true,
  })
  newTargeting: Record<string, any> | null;

  @ApiPropertyOptional({
    description: 'Actor who requested the change',
    example: 'admin@lumenpulse.com',
  })
  actor: string | null;

  @ApiProperty({
    description: 'Timestamp when the mutation was applied',
    example: '2024-06-01T12:00:00.000Z',
  })
  changedAt: Date;
}
