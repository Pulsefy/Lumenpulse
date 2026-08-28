import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  Request,
  Logger,
  UsePipes,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContractAdminGuard } from '../common/guards/contract-admin.guard';
import { ContractAdminAuditService } from '../contract-admin/contract-admin-audit.service';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { ApiIdempotencyHeader } from '../common/decorators/api-idempotency.decorator';
import { AllocateBudgetDto } from './dto/allocate-budget.dto';
import {
  AllocateBudgetResponseDto,
  StreamStateDto,
} from './dto/stream-response.dto';
import { RotateBeneficiaryDto } from './dto/rotate-beneficiary.dto';
import {
  StreamPreviewDto,
  StreamPreviewResponseDto,
} from './dto/stream-preview.dto';
import {
  QueryBeneficiaryHistoryDto,
  BeneficiaryHistoryResponseDto,
} from './dto/beneficiary-history.dto';
import { TreasuryService } from './treasury.service';
import { AuditBlockchainAction } from '../admin-audit/decorators/audit-blockchain-action.decorator';
import { Request as ExpressRequest } from 'express';
import { CustomValidationPipe } from '../common/pipes/validation.pipe';

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

@ApiTags('treasury')
@Controller('treasury')
@UsePipes(CustomValidationPipe)
export class TreasuryController {
  private readonly logger = new Logger(TreasuryController.name);

  constructor(
    private readonly treasuryService: TreasuryService,
    private readonly auditService: ContractAdminAuditService,
  ) {}

  @Post('streams')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, ContractAdminGuard)
  @Roles(UserRole.ADMIN)
  @AuditBlockchainAction({ contractField: 'beneficiary' })
  @ApiBearerAuth('JWT-auth')
  @ApiIdempotencyHeader()
  @ApiOperation({
    summary: 'Allocate a treasury budget and start a stream (admin only)',
    description:
      'Builds, signs and submits a Soroban `allocate_budget` transaction to ' +
      'the treasury contract, starting a vesting stream for the beneficiary.',
  })
  @ApiResponse({
    status: 201,
    description: 'Allocation submitted and confirmed',
    type: AllocateBudgetResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  @ApiResponse({ status: 502, description: 'Treasury transaction failed' })
  @ApiResponse({
    status: 503,
    description: 'Treasury not configured / RPC down',
  })
  async allocateBudget(
    @Body() dto: AllocateBudgetDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<AllocateBudgetResponseDto> {
    const user = req.user!;
    this.logger.log(
      `Admin ${user.id} allocating budget: ${dto.amount} to ${dto.beneficiary}`,
    );

    // Log the blockchain operation
    await this.auditService.logBlockchainOperation(
      {
        actorId: user.id,
        actorEmail: user.email,
        endpoint: 'POST /treasury/streams',
        targetContract: 'treasury',
        paramsSummary: {
          beneficiary: dto.beneficiary,
          amount: dto.amount,
          startTime: dto.startTime,
          duration: dto.duration,
        },
        responseStatus: HttpStatus.CREATED,
      },
      req as ExpressRequest,
    );

    return this.treasuryService.allocateBudget(dto, {
      actorId: user.id,
      actorEmail: user.email,
    });
  }

  @Get('streams/:beneficiary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get treasury stream state for a beneficiary',
    description:
      'Returns the current stream state (total, claimed, unlocked and ' +
      'remaining amounts) for a beneficiary from the treasury contract.',
  })
  @ApiParam({
    name: 'beneficiary',
    description: 'Stellar address of the beneficiary',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @ApiResponse({
    status: 200,
    description: 'Stream state retrieved successfully',
    type: StreamStateDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid beneficiary address' })
  @ApiResponse({ status: 404, description: 'No stream found for beneficiary' })
  @ApiResponse({
    status: 503,
    description: 'Treasury not configured / RPC down',
  })
  async getStream(
    @Param('beneficiary') beneficiary: string,
  ): Promise<StreamStateDto> {
    return this.treasuryService.getStream(beneficiary);
  }

  @Get('streams/:beneficiary/history')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ContractAdminGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Get audit-safe beneficiary change history for a stream or account (admin only)',
    description:
      'Exposes treasury stream beneficiary changes and audit history with actor context and timestamps.',
  })
  @ApiParam({
    name: 'beneficiary',
    description: 'Stellar address of the stream beneficiary or account',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @ApiResponse({
    status: 200,
    description: 'Beneficiary history retrieved successfully',
    type: BeneficiaryHistoryResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  async getStreamHistory(
    @Param('beneficiary') beneficiary: string,
    @Query() query: QueryBeneficiaryHistoryDto,
  ): Promise<BeneficiaryHistoryResponseDto> {
    return this.treasuryService.getBeneficiaryHistory({
      ...query,
      beneficiary,
    });
  }

  @Get('beneficiary-history')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ContractAdminGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Query treasury stream beneficiary history and audit trail (admin only)',
    description:
      'Exposes treasury stream beneficiary changes, rotation history, and audit-safe logs for admin UIs and ops teams.',
  })
  @ApiResponse({
    status: 200,
    description: 'Beneficiary history retrieved successfully',
    type: BeneficiaryHistoryResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  async getBeneficiaryHistory(
    @Query() query: QueryBeneficiaryHistoryDto,
  ): Promise<BeneficiaryHistoryResponseDto> {
    return this.treasuryService.getBeneficiaryHistory(query);
  }

  @Post('streams/rotate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, ContractAdminGuard)
  @Roles(UserRole.ADMIN)
  @AuditBlockchainAction({ contractField: 'oldBeneficiary' })
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Rotate beneficiary for a treasury stream (admin only)',
    description:
      'Builds, signs and submits a Soroban `rotate_beneficiary` transaction to ' +
      'the treasury contract, rotating the beneficiary while preserving accrued ' +
      'claim state.',
  })
  @ApiResponse({
    status: 200,
    description: 'Beneficiary rotated successfully',
    type: AllocateBudgetResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  @ApiResponse({
    status: 404,
    description: 'Stream not found for old beneficiary',
  })
  @ApiResponse({ status: 502, description: 'Treasury transaction failed' })
  @ApiResponse({
    status: 503,
    description: 'Treasury not configured / RPC down',
  })
  async rotateBeneficiary(
    @Body() dto: RotateBeneficiaryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<AllocateBudgetResponseDto> {
    const user = req.user!;
    this.logger.log(
      `Admin ${user.id} rotating beneficiary: ${dto.oldBeneficiary}`,
    );

    // Log the blockchain operation
    await this.auditService.logBlockchainOperation(
      {
        actorId: user.id,
        actorEmail: user.email,
        endpoint: 'POST /treasury/streams/rotate',
        targetContract: 'treasury',
        paramsSummary: {
          oldBeneficiary: dto.oldBeneficiary,
          hasNewBeneficiary: !!dto.newBeneficiary,
        },
        responseStatus: HttpStatus.OK,
      },
      req as ExpressRequest,
    );

    return this.treasuryService.rotateBeneficiary(dto, {
      actorId: user.id,
      actorEmail: user.email,
    });
  }

  @Get('streams/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview unlocked treasury stream amounts for a beneficiary',
    description:
      'Read-only endpoint that computes unlocked, claimed, and remaining ' +
      'stream amounts using the same linear-vesting formula as the on-chain ' +
      'contract. No transaction is submitted. Useful for dashboards and ' +
      'debugging tools.',
  })
  @ApiResponse({
    status: 200,
    description: 'Stream preview calculated successfully',
    type: StreamPreviewResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid beneficiary address or atTime',
  })
  @ApiResponse({ status: 404, description: 'No stream found for beneficiary' })
  @ApiResponse({
    status: 503,
    description: 'Treasury not configured / RPC down',
  })
  async previewStream(
    @Query() dto: StreamPreviewDto,
  ): Promise<StreamPreviewResponseDto> {
    return this.treasuryService.previewStream(dto);
  }
}
