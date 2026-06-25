import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { AllocateBudgetDto } from './dto/allocate-budget.dto';
import {
  AllocateBudgetResponseDto,
  StreamStateDto,
} from './dto/stream-response.dto';
import { RotateBeneficiaryDto } from './dto/rotate-beneficiary.dto';
import { TreasuryService } from './treasury.service';

@ApiTags('treasury')
@Controller('treasury')
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  @Post('streams')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
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
  ): Promise<AllocateBudgetResponseDto> {
    return this.treasuryService.allocateBudget(dto);
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

  @Post('streams/rotate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
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
  @ApiResponse({ status: 404, description: 'Stream not found for old beneficiary' })
  @ApiResponse({ status: 502, description: 'Treasury transaction failed' })
  @ApiResponse({
    status: 503,
    description: 'Treasury not configured / RPC down',
  })
  async rotateBeneficiary(
    @Body() dto: RotateBeneficiaryDto,
  ): Promise<AllocateBudgetResponseDto> {
    return this.treasuryService.rotateBeneficiary(dto);
  }
}
