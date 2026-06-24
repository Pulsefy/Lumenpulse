import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { BlockchainAuditService, BlockchainAuditQueryOptions } from './blockchain-audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { BlockchainAuditLog } from './entities/blockchain-audit-log.entity';

/**
 * Admin-only controller for querying blockchain audit logs.
 * Allows maintainers and admins to view the audit trail of all
 * blockchain-triggered admin actions for compliance and investigation.
 */
@ApiTags('admin-blockchain-audit')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/blockchain-audit')
export class BlockchainAuditController {
  constructor(private readonly blockchainAuditService: BlockchainAuditService) {}

  /**
   * Query blockchain audit logs with optional filters.
   * Returns paginated results, sortable by various fields.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Query blockchain audit logs (admin only)',
    description:
      'Retrieves a paginated list of blockchain audit logs. ' +
      'Allows filtering by actor, contract, transaction status, and date range. ' +
      'Sensitive data is redacted before persistence.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 50 })
  @ApiQuery({ name: 'offset', required: false, type: Number, example: 0 })
  @ApiQuery({
    name: 'actorId',
    required: false,
    type: String,
    description: 'Filter by user ID of the actor',
  })
  @ApiQuery({
    name: 'targetContract',
    required: false,
    type: String,
    enum: ['matching_pool', 'treasury', 'registry'],
    description: 'Filter by target contract',
  })
  @ApiQuery({
    name: 'txStatus',
    required: false,
    type: String,
    enum: ['pending', 'success', 'failed'],
    description: 'Filter by transaction status',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    type: String,
    format: 'date-time',
    description: 'Filter for actions on or after this date',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    type: String,
    format: 'date-time',
    description: 'Filter for actions on or before this date',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    type: String,
    enum: ['createdAt', 'txHash', 'targetContract'],
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    type: String,
    enum: ['ASC', 'DESC'],
    description: 'Sort order',
  })
  @ApiResponse({
    status: 200,
    description: 'Audit logs retrieved successfully',
    schema: {
      properties: {
        logs: {
          type: 'array',
          items: { $ref: '#/components/schemas/BlockchainAuditLog' },
        },
        count: { type: 'number', example: 1 },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  async query(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('actorId') actorId?: string,
    @Query('targetContract') targetContract?: string,
    @Query('txStatus') txStatus?: string,
    @Query('startDate') startDateStr?: string,
    @Query('endDate') endDateStr?: string,
    @Query('sortBy') sortBy?: 'createdAt' | 'txHash' | 'targetContract',
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
  ) {
    const queryOptions: BlockchainAuditQueryOptions = {
      limit,
      offset,
      actorId,
      targetContract,
      txStatus,
      sortBy: sortBy || 'createdAt',
      sortOrder: sortOrder || 'DESC',
    };

    if (startDateStr) {
      queryOptions.startDate = new Date(startDateStr);
    }
    if (endDateStr) {
      queryOptions.endDate = new Date(endDateStr);
    }

    const [logs, count] = await this.blockchainAuditService.query(queryOptions);
    return { logs, count };
  }

  /**
   * Get a single blockchain audit log by ID.
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a single blockchain audit log by ID',
    description:
      'Retrieves detailed information about a specific blockchain audit log entry.',
  })
  @ApiParam({
    name: 'id',
    description: 'The UUID of the audit log entry',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Audit log retrieved successfully',
    type: BlockchainAuditLog,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  @ApiResponse({ status: 404, description: 'Audit log not found' })
  async getById(@Param('id') id: string): Promise<BlockchainAuditLog | null> {
    return this.blockchainAuditService.findById(id);
  }

  /**
   * Find all audit logs for a specific transaction hash.
   * Useful for investigating a particular blockchain transaction.
   */
  @Get('by-tx/:txHash')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Find audit logs by transaction hash',
    description:
      'Retrieves all audit log entries related to a specific transaction hash. ' +
      'Useful for on-chain transaction investigation and verification.',
  })
  @ApiParam({
    name: 'txHash',
    description: 'The transaction hash (hex-encoded)',
    example:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  })
  @ApiResponse({
    status: 200,
    description: 'Audit logs retrieved successfully',
    type: [BlockchainAuditLog],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  async getByTxHash(@Param('txHash') txHash: string): Promise<BlockchainAuditLog[]> {
    return this.blockchainAuditService.findByTxHash(txHash);
  }

  /**
   * Find all audit logs for a specific actor (admin user).
   * Useful for investigating admin actions by a specific user.
   */
  @Get('by-actor/:actorId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Find audit logs by actor ID',
    description:
      'Retrieves all blockchain audit log entries created by a specific admin user. ' +
      'Useful for accountability tracking and user action investigation.',
  })
  @ApiParam({
    name: 'actorId',
    description: 'The user ID of the admin',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 50,
    description: 'Maximum number of results to return',
  })
  @ApiResponse({
    status: 200,
    description: 'Audit logs retrieved successfully',
    type: [BlockchainAuditLog],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  async getByActor(
    @Param('actorId') actorId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<BlockchainAuditLog[]> {
    return this.blockchainAuditService.findByActor(actorId, limit);
  }

  /**
   * Find all audit logs for a specific contract.
   * Useful for auditing all actions against a particular smart contract.
   */
  @Get('by-contract/:targetContract')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Find audit logs by target contract',
    description:
      'Retrieves all blockchain audit log entries for a specific smart contract. ' +
      'Useful for compliance and contract-level action auditing.',
  })
  @ApiParam({
    name: 'targetContract',
    description: 'The target contract name',
    enum: ['matching_pool', 'treasury', 'registry'],
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    example: 50,
    description: 'Maximum number of results to return',
  })
  @ApiResponse({
    status: 200,
    description: 'Audit logs retrieved successfully',
    type: [BlockchainAuditLog],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (admin only)' })
  async getByContract(
    @Param('targetContract') targetContract: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ): Promise<BlockchainAuditLog[]> {
    return this.blockchainAuditService.findByContract(targetContract, limit);
  }
}
