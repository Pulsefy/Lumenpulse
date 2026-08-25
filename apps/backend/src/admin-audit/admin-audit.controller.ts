import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AdminAuditService } from './admin-audit.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

// DTO for querying feature flag audit logs.
// This can be extended to support additional filters.
class QueryFeatureFlagAuditLogsDto {
  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  flagKey?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@Controller('admin/audit/blockchain')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAuditController {
  constructor(private readonly auditService: AdminAuditService) {}

  /**
   * GET /admin/audit/blockchain
   * Query audit logs. Supports filtering by actorId, endpoint, and date range.
   */
  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async getLogs(@Query() query: QueryAuditLogsDto) {
    const { data, total } = await this.auditService.query({
      actorId: query.actorId,
      endpoint: query.endpoint,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });

    return {
      data,
      meta: {
        total,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      },
    };
  }

  /**
   * GET /admin/audit/blockchain/feature-flags
   * Query feature flag change history. Each record contains actor, previous value,
   * new value, and timestamp. This is an application-level audit trail.
   * The on-chain feature_flags contract is the authoritative source of truth for
   * flag state, while this endpoint provides an auditable history of mutations.
   */
  @Get('feature-flags')
  @UsePipes(new ValidationPipe({ transform: true }))
  async getFeatureFlagLogs(@Query() query: QueryFeatureFlagAuditLogsDto) {
    const { data, total } = await this.auditService.queryFeatureFlagAudits({
      actorId: query.actorId,
      flagKey: query.flagKey,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      limit: query.limit,
    });

    return {
      data,
      meta: {
        total,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      },
    };
  }
}