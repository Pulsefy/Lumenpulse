import { IsString, IsBoolean, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertFeatureFlagDto {
  @ApiProperty({
    description: 'Unique feature flag key',
    example: 'new-onboarding-flow',
  })
  @IsString()
  key: string;

  @ApiProperty({ description: 'Whether the feature is enabled', example: true })
  @IsBoolean()
  enabled: boolean;

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
    description:
      "Flag's enabled state after this mutation (null for removals)",
    example: true,
  })
  newEnabled: boolean | null;

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
