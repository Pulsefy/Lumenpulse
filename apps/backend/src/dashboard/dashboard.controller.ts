import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardResponse, DashboardService } from './dashboard.service';

interface AuthenticatedRequest extends Request {
  user: { id: string };
}

@ApiTags('dashboard')
@ApiBearerAuth('JWT-auth')
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the authenticated user dashboard in one request',
    description:
      'Loads portfolio, watchlist, signals, and latest news concurrently. Each section degrades independently when its backing service is unavailable. Responses are cached per user for 15 seconds.',
  })
  @ApiOkResponse({
    description: 'Aggregated dashboard payload',
    schema: {
      type: 'object',
      properties: {
        generatedAt: { type: 'string', format: 'date-time' },
        cacheTtlMs: { type: 'number' },
        portfolio: {
          type: 'object',
          properties: {
            data: { type: 'object', nullable: true },
            error: { type: 'string', nullable: true, enum: ['unavailable'] },
          },
        },
        watchlist: {
          type: 'object',
          properties: {
            data: { type: 'object', nullable: true },
            error: { type: 'string', nullable: true, enum: ['unavailable'] },
          },
        },
        signals: {
          type: 'object',
          properties: {
            data: { type: 'object', nullable: true },
            error: { type: 'string', nullable: true, enum: ['unavailable'] },
          },
        },
        news: {
          type: 'object',
          properties: {
            data: { type: 'object', nullable: true },
            error: { type: 'string', nullable: true, enum: ['unavailable'] },
          },
        },
      },
      required: [
        'generatedAt',
        'cacheTtlMs',
        'portfolio',
        'watchlist',
        'signals',
        'news',
      ],
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getDashboard(@Req() req: AuthenticatedRequest): Promise<DashboardResponse> {
    return this.dashboardService.getDashboard(req.user.id);
  }
}
