import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminAuditService } from './admin-audit.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { ExportAuditLogsDto } from './dto/export-audit-logs.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { AuditLogAction } from '../audit/decorators/audit-log.decorator';

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
   * GET /admin/audit/export
   *
   * Exports audit records from both `audit_logs` and
   * `admin_blockchain_audit_logs` for the specified date range.
   * Each table is capped at 10,000 rows; the `truncated` flag signals when
   * the cap was hit.
   *
   * The request is itself recorded in `audit_logs` via @AuditLogAction —
   * this does not cause circular logging because the interceptor writes to
   * audit_logs whereas this endpoint only reads from it.
   */
  @Get('export')
  @AuditLogAction('admin.audit.export')
  @UsePipes(new ValidationPipe({ transform: true }))
  async exportLogs(
    @Query() query: ExportAuditLogsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="audit-export-${timestamp}.json"`,
    );
    return this.auditService.export(query);
  }
}
