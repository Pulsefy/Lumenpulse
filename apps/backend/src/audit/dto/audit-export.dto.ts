import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { AuditRecordType } from '../retention/audit-retention.policy';

export enum AuditExportFormat {
  JSON = 'json',
  CSV = 'csv',
}

/** Filters for an auditor extract. The date range is inclusive on both ends. */
export class AuditExportQueryDto {
  @ApiProperty({
    description: 'Start of the range (ISO 8601, inclusive)',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsDateString()
  from: string;

  @ApiProperty({
    description: 'End of the range (ISO 8601, inclusive)',
    example: '2026-03-31T23:59:59.999Z',
  })
  @IsDateString()
  to: string;

  @ApiPropertyOptional({
    description:
      'Only records by this actor (user id for user activity, admin id for blockchain actions)',
  })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({
    description: 'Only this record type; all types when omitted',
    enum: AuditRecordType,
  })
  @IsOptional()
  @IsEnum(AuditRecordType)
  recordType?: AuditRecordType;

  @ApiPropertyOptional({
    description: 'Response format',
    enum: AuditExportFormat,
    default: AuditExportFormat.JSON,
  })
  @IsOptional()
  @IsEnum(AuditExportFormat)
  format?: AuditExportFormat;
}

/** One audit record, normalised across the audit tables. */
export class AuditExportRecordDto {
  @ApiProperty({ enum: AuditRecordType })
  recordType: AuditRecordType;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    description: 'User or admin who performed the action',
    nullable: true,
    type: String,
  })
  actorId: string | null;

  @ApiProperty({
    description: 'Action name, or "METHOD /path" for blockchain actions',
    example: 'login',
  })
  action: string;

  @ApiProperty({ nullable: true, type: String, example: '127.0.0.1' })
  ipAddress: string | null;

  @ApiProperty({
    description: 'Type-specific fields (request metadata, tx hash, ...)',
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  details: Record<string, unknown> | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;
}

/** Filters that produced an extract, echoed back for the auditor's records. */
export class AuditExportFiltersDto {
  @ApiProperty({ type: String, format: 'date-time' })
  from: string;

  @ApiProperty({ type: String, format: 'date-time' })
  to: string;

  @ApiProperty({ nullable: true, type: String })
  actorId: string | null;

  @ApiProperty({ enum: AuditRecordType, isArray: true })
  recordTypes: AuditRecordType[];
}

export class AuditExportResponseDto {
  @ApiProperty({ type: AuditExportFiltersDto })
  filters: AuditExportFiltersDto;

  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt: string;

  @ApiProperty({ description: 'Number of records in this extract' })
  count: number;

  @ApiProperty({
    description:
      'True when more records matched than the export row limit; narrow the range and export again',
  })
  truncated: boolean;

  @ApiProperty({
    description: 'Matching records, oldest first',
    type: [AuditExportRecordDto],
  })
  records: AuditExportRecordDto[];
}
