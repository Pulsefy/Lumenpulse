import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ContractHealthSnapshotService } from './contract-health-snapshot.service';

/**
 * Exposes persisted contract-health snapshot data.
 *
 * All endpoints are read-only GET requests except the manual-capture POST,
 * which is intended for admin / release-review workflows.
 *
 * Routes are nested under /health/contracts/snapshots so they sit alongside
 * the existing GET /health/contracts check and share the same Swagger tag.
 */
@ApiTags('health')
@Controller('health/contracts/snapshots')
export class ContractHealthSnapshotController {
  constructor(
    private readonly snapshotService: ContractHealthSnapshotService,
  ) {}

  // -------------------------------------------------------------------------
  // GET /health/contracts/snapshots/latest
  // -------------------------------------------------------------------------

  @Get('latest')
  @ApiOperation({
    summary: 'Return the most recent contract health snapshot',
    description:
      'Fetches the last persisted snapshot produced by the 30-minute ' +
      'scheduler (or a manual capture).  Returns HTTP 404 when no snapshots ' +
      'have been captured yet.',
  })
  @ApiQuery({
    name: 'network',
    required: false,
    description: 'Filter by network (testnet | mainnet)',
    example: 'testnet',
  })
  @ApiResponse({ status: 200, description: 'Latest snapshot returned.' })
  @ApiResponse({
    status: 404,
    description: 'No snapshots captured yet.',
  })
  async getLatest(@Query('network') network?: string) {
    return this.snapshotService.getLatest(network);
  }

  // -------------------------------------------------------------------------
  // GET /health/contracts/snapshots
  // -------------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary: 'Return paginated contract health snapshot history',
    description:
      'Returns snapshots newest-first. Use `limit` and `offset` for ' +
      'pagination.  Limit is capped server-side at 200 rows.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Maximum rows to return (default 50, max 200)',
    example: 50,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    description: 'Rows to skip for pagination (default 0)',
    example: 0,
  })
  @ApiQuery({
    name: 'network',
    required: false,
    description: 'Filter by network (testnet | mainnet)',
    example: 'testnet',
  })
  @ApiQuery({
    name: 'since',
    required: false,
    description:
      'ISO 8601 timestamp — only return snapshots captured after this time',
    example: '2025-01-01T00:00:00Z',
  })
  @ApiResponse({ status: 200, description: 'Snapshot history returned.' })
  async getHistory(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('network') network?: string,
    @Query('since') since?: string,
  ) {
    return this.snapshotService.getHistory({
      limit: limit !== undefined ? parseInt(limit, 10) : undefined,
      offset: offset !== undefined ? parseInt(offset, 10) : undefined,
      network,
      since: since ? new Date(since) : undefined,
    });
  }

  // -------------------------------------------------------------------------
  // GET /health/contracts/snapshots/diff
  // -------------------------------------------------------------------------

  @Get('diff')
  @ApiOperation({
    summary: 'Diff the two most recent snapshots (or a specific pair)',
    description:
      'When called without parameters, diffs the latest snapshot against ' +
      'the one before it — useful for dashboards that want to surface drift ' +
      'since the last capture.  Supply `baselineId` and `currentId` to ' +
      'compare any arbitrary pair.  Returns HTTP 404 when fewer than two ' +
      'snapshots exist, or when a supplied id is unknown.',
  })
  @ApiQuery({
    name: 'baselineId',
    required: false,
    description: 'UUID of the earlier (baseline) snapshot',
  })
  @ApiQuery({
    name: 'currentId',
    required: false,
    description: 'UUID of the later (current) snapshot',
  })
  @ApiResponse({ status: 200, description: 'Diff result returned.' })
  @ApiResponse({
    status: 404,
    description: 'Not enough snapshots, or a supplied id was not found.',
  })
  async getDiff(
    @Query('baselineId') baselineId?: string,
    @Query('currentId') currentId?: string,
  ) {
    return this.snapshotService.getDiff(baselineId, currentId);
  }

  // -------------------------------------------------------------------------
  // GET /health/contracts/snapshots/:id
  // -------------------------------------------------------------------------

  @Get(':id')
  @ApiOperation({ summary: 'Return a single snapshot by UUID' })
  @ApiParam({
    name: 'id',
    description: 'Snapshot UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiResponse({ status: 200, description: 'Snapshot returned.' })
  @ApiResponse({ status: 404, description: 'Snapshot not found.' })
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.snapshotService.getById(id);
  }

  // -------------------------------------------------------------------------
  // POST /health/contracts/snapshots
  // -------------------------------------------------------------------------

  @Post()
  @ApiOperation({
    summary: 'Trigger a manual contract health snapshot capture',
    description:
      'Runs a live health check immediately and persists the result.  ' +
      'Intended for admin and release-review workflows where you want a ' +
      'snapshot captured outside the regular 30-minute cadence.  ' +
      'Returns the newly created snapshot.',
  })
  @ApiResponse({ status: 201, description: 'Snapshot captured and stored.' })
  async captureManual(@Res({ passthrough: true }) res: Response) {
    const snapshot = await this.snapshotService.captureSnapshot('manual');
    res.status(201);
    return snapshot;
  }
}
