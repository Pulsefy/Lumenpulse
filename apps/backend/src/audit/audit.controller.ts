import {
  Controller,
  Get,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Req,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiOkResponse,
  ApiProduces,
} from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { AuditExportService } from './export/audit-export.service';
import {
  AuditExportFormat,
  AuditExportQueryDto,
  AuditExportResponseDto,
} from './dto/audit-export.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('admin-audit-logs')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/audit-logs')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly auditExportService: AuditExportService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get all audit logs (admin only)',
    description:
      'Retrieves a paginated list of audit logs. Requires admin privileges.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Audit logs retrieved successfully',
    schema: {
      properties: {
        logs: {
          type: 'array',
          items: {
            properties: {
              id: { type: 'string', format: 'uuid' },
              userId: { type: 'string', format: 'uuid', nullable: true },
              action: { type: 'string', example: 'login' },
              ipAddress: { type: 'string', example: '127.0.0.1' },
              metadata: { type: 'object', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        count: { type: 'number', example: 1 },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  async getAuditLogs(
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    const [logs, count] = await this.auditService.findAll(limit, offset);
    return { logs, count };
  }

  @Get('export')
  @ApiOperation({
    summary: 'Export an audit extract (admin only)',
    description:
      'Produces a scoped extract of user-activity, audit-operation and admin blockchain-action records for an auditor, filtered by an inclusive date range and optionally by actor and record type. Returns JSON, or CSV with format=csv. Every export is itself recorded in the audit trail as an "audit.export" action.',
  })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({
    description: 'Audit extract (text/csv when format=csv)',
    type: AuditExportResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid filters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  async exportAuditLogs(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    query: AuditExportQueryDto,
    @Req() req: Request & { user?: { id?: string; sub?: string } },
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuditExportResponseDto | string> {
    const format = query.format ?? AuditExportFormat.JSON;
    const result = await this.auditExportService.export({
      from: new Date(query.from),
      to: new Date(query.to),
      actorId: query.actorId,
      recordType: query.recordType,
      format,
      requestedBy: req.user?.id ?? req.user?.sub ?? null,
      ipAddress: req.ip ?? null,
    });

    if (format === AuditExportFormat.CSV) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="audit-export-${result.generatedAt.replace(/[:.]/g, '-')}.csv"`,
      );
      return this.auditExportService.toCsv(result);
    }
    return result;
  }
}
