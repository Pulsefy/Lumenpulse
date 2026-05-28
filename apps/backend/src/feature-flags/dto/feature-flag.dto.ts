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
}
