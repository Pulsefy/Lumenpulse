import { IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for GET /admin/audit/export
 *
 * `from` and `to` are required — both ends of the date range must be supplied
 * to avoid unbounded queries. `actorId` and `endpoint` are optional filters
 * applied to the admin_blockchain_audit_logs table only (they have no
 * equivalent in the general audit_logs table).
 */
export class ExportAuditLogsDto {
  @ApiProperty({
    description: 'Start of the date range (inclusive), ISO 8601',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsDateString()
  from: string;

  @ApiProperty({
    description: 'End of the date range (inclusive), ISO 8601',
    example: '2026-03-31T23:59:59.999Z',
  })
  @IsDateString()
  to: string;

  @ApiPropertyOptional({
    description: 'Filter admin blockchain logs by actor (user) ID',
    example: 'usr_abc123',
  })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({
    description:
      'Filter admin blockchain logs by endpoint string, e.g. "POST /grants/rounds"',
    example: 'POST /grants/rounds',
  })
  @IsOptional()
  @IsString()
  endpoint?: string;
}
