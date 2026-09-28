import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class RenderedMessageTemplateDto {
  @ApiPropertyOptional()
  subject?: string;

  @ApiPropertyOptional()
  title?: string;

  @ApiPropertyOptional()
  message?: string;

  @ApiPropertyOptional()
  body?: string;

  @ApiProperty()
  templateKey: string;

  @ApiProperty()
  version: number;
}

export class PreviewMessageTemplateDto {
  @ApiPropertyOptional({
    description:
      'Variable values for preview. When omitted, the template sampleVariables are used.',
    example: { symbol: 'XLM', currentPrice: '0.16' },
  })
  @IsOptional()
  @IsObject()
  variables?: Record<string, string | number>;
}

export class UpdateMessageTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  subjectTemplate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  titleTemplate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  messageTemplate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bodyTemplate?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Variables that must be supplied at render time',
  })
  @IsOptional()
  @IsString({ each: true })
  requiredVariables?: string[];

  @ApiPropertyOptional({
    description: 'Default sample data used by the preview endpoint',
  })
  @IsOptional()
  @IsObject()
  sampleVariables?: Record<string, string>;
}

export class MessageTemplateResponseDto {
  @ApiProperty()
  key: string;

  @ApiProperty()
  version: number;

  @ApiPropertyOptional({ nullable: true })
  subjectTemplate: string | null;

  @ApiPropertyOptional({ nullable: true })
  titleTemplate: string | null;

  @ApiPropertyOptional({ nullable: true })
  messageTemplate: string | null;

  @ApiPropertyOptional({ nullable: true })
  bodyTemplate: string | null;

  @ApiProperty({ type: [String] })
  requiredVariables: string[];

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  sampleVariables: Record<string, string>;

  @ApiProperty()
  updatedAt: Date;
}

export class MessageTemplateAuditLogResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  templateKey: string;

  @ApiProperty({ enum: ['create', 'update'] })
  action: 'create' | 'update';

  @ApiProperty()
  previousVersion: number;

  @ApiProperty()
  newVersion: number;

  @ApiProperty({ type: Object, additionalProperties: true })
  previousSnapshot: Record<string, unknown>;

  @ApiProperty({ type: Object, additionalProperties: true })
  newSnapshot: Record<string, unknown>;

  @ApiPropertyOptional({ nullable: true })
  actor: string | null;

  @ApiProperty()
  changedAt: Date;
}

export class MessageTemplateKeyParamDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  key: string;
}
