import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
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
import { RolesGuard } from '../../auth/roles.guard';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles, UserRole } from '../../auth/decorators/auth.decorators';
import { BlockchainAudit } from '../../audit/decorators/blockchain-audit.decorator';

@ApiTags('Admin — Matching Pool')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/matching-pool')
export class MatchingPoolAdminController {
  constructor(private readonly service: MatchingPoolAdminService) {}

  @Post('rounds')
  @HttpCode(HttpStatus.CREATED)
  @BlockchainAudit({
    targetContract: 'matching_pool',
    functionName: 'create_round',
    description: 'Create a new matching round with specified funds',
    paramsToLog: ['name', 'matchingFunds'],
  })
  @ApiOperation({ summary: 'Create a new matching round on-chain' })
  @ApiResponse({ status: 201, type: RoundResponseDto })
  createRound(
    @Body() dto: CreateRoundDto,
    @Request() req: { user: { id: string } },
  ): Promise<RoundResponseDto> {
    return this.service.createRound(dto, req.user.id);
  }

  @Post('rounds/:roundId/approve-project')
  @HttpCode(HttpStatus.OK)
  @BlockchainAudit({
    targetContract: 'matching_pool',
    functionName: 'approve_project',
    description: 'Approve a project to participate in a matching round',
    paramsToLog: ['projectAddress'],
  })
  @ApiOperation({ summary: 'Approve a project for a matching round' })
  @ApiResponse({ status: 200, type: RoundResponseDto })
  approveProject(
    @Param('roundId') roundId: string,
    @Body() dto: ApproveProjectDto,
    @Request() req: { user: { id: string } },
  ): Promise<RoundResponseDto> {
    return this.service.approveProject(roundId, dto, req.user.id);
  }
}

