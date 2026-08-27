import {
  IsString,
  IsOptional,
  IsEnum,
  IsNotEmpty,
  MaxLength,
  IsArray,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntityKind } from '../../database/entities/entity-alias.entity';

export class CreateAliasDto {
  @ApiProperty({
    description: 'Entity type this alias belongs to',
    enum: ['project', 'asset', 'tag', 'category'],
    example: 'project',
  })
  @IsEnum(['project', 'asset', 'tag', 'category'])
  entityKind: EntityKind;

  @ApiProperty({
    description: 'Canonical / normalized value for the entity',
    example: 'SolarFarm DAO',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  canonicalValue: string;

  @ApiProperty({
    description: 'Alias / synonym that maps to the canonical value',
    example: 'solarfarm',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  alias: string;

  @ApiPropertyOptional({
    description: 'Who created this alias',
    example: 'contributor@lumenpulse.com',
  })
  @IsOptional()
  @IsString()
  createdBy?: string;

  @ApiPropertyOptional({
    description: 'Optional note about the alias (e.g. source)',
    example: 'Common community shorthand',
  })
  @IsOptional()
  @IsString()
  note?: string;
}

export class BatchCreateAliasDto {
  @ApiProperty({
    description: 'Entity type these aliases belong to',
    enum: ['project', 'asset', 'tag', 'category'],
    example: 'tag',
  })
  @IsEnum(['project', 'asset', 'tag', 'category'])
  entityKind: EntityKind;

  @ApiProperty({
    description: 'Canonical / normalized value',
    example: 'DeFi',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  canonicalValue: string;

  @ApiProperty({
    description: 'Multiple aliases / synonyms',
    type: [String],
    example: ['defi', 'decentralized finance', 'decentralized-finance'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  aliases: string[];

  @ApiPropertyOptional({
    description: 'Who created these aliases',
    example: 'contributor@lumenpulse.com',
  })
  @IsOptional()
  @IsString()
  createdBy?: string;

  @ApiPropertyOptional({
    description: 'Optional note applied to all aliases in this batch',
    example: 'Batch import from community spreadsheet',
  })
  @IsOptional()
  @IsString()
  note?: string;
}

export class AliasResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-...' })
  id: string;

  @ApiProperty({
    enum: ['project', 'asset', 'tag', 'category'],
    example: 'project',
  })
  entityKind: EntityKind;

  @ApiProperty({ example: 'SolarFarm DAO' })
  canonicalValue: string;

  @ApiProperty({ example: 'solarfarm' })
  alias: string;

  @ApiPropertyOptional({ example: 'contributor@lumenpulse.com' })
  createdBy?: string | null;

  @ApiPropertyOptional({ example: 'Common community shorthand' })
  note?: string | null;

  @ApiProperty({ example: '2025-08-27T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2025-08-27T10:00:00.000Z' })
  updatedAt: string;
}

export class NormalizeResultDto {
  @ApiProperty({
    description: 'Original input value',
    example: 'solarfarm',
  })
  original: string;

  @ApiProperty({
    description: 'Canonical / normalized value if an alias matched, otherwise the original lowercased',
    example: 'SolarFarm DAO',
  })
  canonical: string;

  @ApiProperty({
    description: 'Whether an alias mapping was found',
    example: true,
  })
  matched: boolean;

  @ApiProperty({
    enum: ['project', 'asset', 'tag', 'category'],
    example: 'project',
  })
  entityKind?: EntityKind;
}

export class AliasListQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by entity kind',
    enum: ['project', 'asset', 'tag', 'category'],
  })
  @IsOptional()
  @IsEnum(['project', 'asset', 'tag', 'category'])
  entityKind?: EntityKind;

  @ApiPropertyOptional({
    description: 'Filter by canonical value (exact, case-insensitive)',
    example: 'SolarFarm DAO',
  })
  @IsOptional()
  @IsString()
  canonicalValue?: string;
}
