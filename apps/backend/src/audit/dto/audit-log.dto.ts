import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditAction } from '../entities/audit-log.entity';

export class AuditLogDto {
  @ApiProperty({ description: 'Unique identifier for the audit log entry' })
  id: string;

  @ApiProperty({ description: 'ID of the user who performed the action' })
  userId: string;

  @ApiProperty({
    description: 'Type of action performed',
    enum: AuditAction,
    example: AuditAction.LOGIN,
  })
  action: AuditAction;

  @ApiProperty({ description: 'Timestamp when the action occurred' })
  timestamp: Date;

  @ApiPropertyOptional({ description: 'IP address of the client' })
  ipAddress?: string;

  @ApiPropertyOptional({ description: 'User agent string of the client' })
  userAgent?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata about the action',
    type: 'object',
    additionalProperties: true,
  })
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Status of the action' })
  status?: string;

  @ApiPropertyOptional({ description: 'Additional details about the action' })
  details?: string;
}

export class CreateAuditLogDto {
  @ApiProperty({ description: 'ID of the user who performed the action' })
  userId: string;

  @ApiProperty({
    description: 'Type of action performed',
    enum: AuditAction,
    example: AuditAction.LOGIN,
  })
  action: AuditAction;

  @ApiPropertyOptional({ description: 'IP address of the client' })
  ipAddress?: string;

  @ApiPropertyOptional({ description: 'User agent string of the client' })
  userAgent?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata about the action',
    type: 'object',
    additionalProperties: true,
  })
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Status of the action' })
  status?: string;

  @ApiPropertyOptional({ description: 'Additional details about the action' })
  details?: string;
}

export class AuditLogQueryDto {
  @ApiPropertyOptional({ description: 'Filter by user ID' })
  userId?: string;

  @ApiPropertyOptional({
    description: 'Filter by action type',
    enum: AuditAction,
  })
  action?: AuditAction;

  @ApiPropertyOptional({ description: 'Filter by start date' })
  startDate?: Date;

  @ApiPropertyOptional({ description: 'Filter by end date' })
  endDate?: Date;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  limit?: number;
}

export class AuditLogListResponseDto {
  @ApiProperty({ description: 'List of audit log entries', type: [AuditLogDto] })
  data: AuditLogDto[];

  @ApiProperty({ description: 'Total number of entries' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Number of items per page' })
  limit: number;
}
