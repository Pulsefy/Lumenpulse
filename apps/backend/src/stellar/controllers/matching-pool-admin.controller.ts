import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { MatchingPoolAdminService } from '../services/matching-pool-admin.service';
import {
  CreateRoundDto,
  ApproveProjectDto,
  RoundResponseDto,
} from '../dto/matching-pool.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ContractAdminGuard } from '../../common/guards/contract-admin.guard';
import { ContractAdminAuditService } from '../../contract-admin/contract-admin-audit.service';
import { Roles, UserRole } from '../../auth/decorators/auth.decorators';
import { AuditBlockchainAction } from '../../admin-audit/decorators/audit-blockchain-action.decorator';
import { Request as ExpressRequest } from 'express';

// Define a minimal user interface for type safety
interface RequestUser {
  id: string;
  role: UserRole;
  email?: string;
}

// Extend Express Request to include our user
interface AuthenticatedRequest extends ExpressRequest {
  user?: RequestUser;
}

@ApiTags('Admin — Matching Pool')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ContractAdminGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/matching-pool')
export class MatchingPoolAdminController {
  private readonly logger = new Logger(MatchingPoolAdminController.name);

  constructor(
    private readonly service: MatchingPoolAdminService,
    private readonly auditService: ContractAdminAuditService,
  ) {}

  @Post('rounds')
  @HttpCode(HttpStatus.CREATED)
  @AuditBlockchainAction({ contractField: 'matchingFunds' })
  @ApiOperation({ summary: 'Create a new matching round on-chain' })
  @ApiResponse({ status: 201, type: RoundResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async createRound(
    @Body() dto: CreateRoundDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<RoundResponseDto> {
    const user = req.user!;
    this.logger.log(`Admin ${user.id} creating matching round: ${dto.name}`);

    // Log the blockchain operation
    await this.auditService.logBlockchainOperation(
      {
        actorId: user.id,
        actorEmail: user.email,
        endpoint: 'POST /admin/matching-pool/rounds',
        targetContract: 'matching-pool',
        paramsSummary: {
          name: dto.name,
          matchingFunds: dto.matchingFunds,
          description: dto.description,
        },
        responseStatus: HttpStatus.CREATED,
      },
      req as ExpressRequest,
    );

    return this.service.createRound(dto, user.id);
  }

  @Post('rounds/:roundId/approve-project')
  @HttpCode(HttpStatus.OK)
  @AuditBlockchainAction({ contractField: 'projectAddress' })
  @ApiOperation({ summary: 'Approve a project for a matching round' })
  @ApiResponse({ status: 200, type: RoundResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  async approveProject(
    @Param('roundId') roundId: string,
    @Body() dto: ApproveProjectDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<RoundResponseDto> {
    const user = req.user!;
    this.logger.log(
      `Admin ${user.id} approving project ${dto.projectAddress} for round ${roundId}`,
    );

    // Log the blockchain operation
    await this.auditService.logBlockchainOperation(
      {
        actorId: user.id,
        actorEmail: user.email,
        endpoint: `POST /admin/matching-pool/rounds/${roundId}/approve-project`,
        targetContract: 'matching-pool',
        paramsSummary: {
          roundId: roundId,
          projectAddress: dto.projectAddress,
        },
        responseStatus: HttpStatus.OK,
      },
      req as ExpressRequest,
    );

    return this.service.approveProject(roundId, dto, user.id);
  }
}
