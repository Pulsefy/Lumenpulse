import { IsString, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SuppressDriftDto {
  @ApiProperty({ description: 'Entity type, e.g. PortfolioAsset' })
  @IsString()
  entityType: string;

  @ApiProperty({ description: 'Entity ID (UUID)' })
  @IsString()
  entityId: string;

  @ApiProperty({ description: 'Field name, e.g. amount' })
  @IsString()
  field: string;

  @ApiPropertyOptional({ description: 'Reason for suppression' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: 'ISO date when suppression expires' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
