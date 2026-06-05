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
import {
  CreateVestingDto,
  CreateVestingWithMilestoneDto,
} from './dto/create-vesting.dto';
import {
  CreateVestingResponseDto,
  VestingDataDto,
} from './dto/vesting-response.dto';
import { VestingWalletService } from './vesting-wallet.service';

@ApiTags('vesting-wallet')
@Controller('vesting-wallet')
export class VestingWalletController {
  constructor(private readonly vestingWalletService: VestingWalletService) {}

  @Post('vesting')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create a vesting schedule (admin only)',
    description:
      'Builds, signs and submits a Soroban `create_vesting` transaction to ' +
      'the vesting-wallet contract, starting a linear vesting schedule for the beneficiary.',
  })
  @ApiResponse({
    status: 201,
    description: 'Vesting schedule created and confirmed',
    type: CreateVestingResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  @ApiResponse({
    status: 502,
    description: 'Vesting Wallet transaction failed',
  })
  @ApiResponse({
    status: 503,
    description: 'Vesting Wallet not configured / RPC down',
  })
  async createVesting(
    @Body() dto: CreateVestingDto,
  ): Promise<CreateVestingResponseDto> {
    return this.vestingWalletService.createVesting(dto);
  }

  @Post('vesting/milestone')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Create a milestone-linked vesting schedule (admin only)',
    description:
      'Builds, signs and submits a Soroban `create_vesting_with_milestone` transaction to ' +
      'the vesting-wallet contract, creating a linear vesting schedule gated by an external ' +
      'crowdfund vault milestone for the beneficiary.',
  })
  @ApiResponse({
    status: 201,
    description: 'Milestone-gated vesting schedule created and confirmed',
    type: CreateVestingResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Caller is not an admin' })
  @ApiResponse({
    status: 502,
    description: 'Vesting Wallet transaction failed',
  })
  @ApiResponse({
    status: 503,
    description: 'Vesting Wallet not configured / RPC down',
  })
  async createVestingWithMilestone(
    @Body() dto: CreateVestingWithMilestoneDto,
  ): Promise<CreateVestingResponseDto> {
    return this.vestingWalletService.createVestingWithMilestone(dto);
  }

  @Get('vesting/:beneficiary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get vesting schedule for a beneficiary',
    description:
      'Returns the current vesting schedule state (total, claimed, claimable and ' +
      'remaining amounts) for a beneficiary from the vesting-wallet contract.',
  })
  @ApiParam({
    name: 'beneficiary',
    description: 'Stellar address of the beneficiary',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @ApiResponse({
    status: 200,
    description: 'Vesting schedule retrieved successfully',
    type: VestingDataDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid beneficiary address' })
  @ApiResponse({
    status: 404,
    description: 'No vesting schedule found for beneficiary',
  })
  @ApiResponse({
    status: 503,
    description: 'Vesting Wallet not configured / RPC down',
  })
  async getVesting(
    @Param('beneficiary') beneficiary: string,
  ): Promise<VestingDataDto> {
    return this.vestingWalletService.getVesting(beneficiary);
  }

  @Get('vesting/:beneficiary/claimable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview claimable amount for a beneficiary (read-only)',
    description:
      'Returns the current claimable amount for a beneficiary from the vesting-wallet contract ' +
      'without modifying state. Fast read-only endpoint.',
  })
  @ApiParam({
    name: 'beneficiary',
    description: 'Stellar address of the beneficiary',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @ApiResponse({
    status: 200,
    description: 'Claimable amount retrieved successfully',
    type: VestingDataDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid beneficiary address' })
  @ApiResponse({
    status: 404,
    description: 'No vesting schedule found for beneficiary',
  })
  @ApiResponse({
    status: 503,
    description: 'Vesting Wallet not configured / RPC down',
  })
  async getClaimable(
    @Param('beneficiary') beneficiary: string,
  ): Promise<Record<string, string | number>> {
    return this.vestingWalletService.getClaimable(beneficiary);
  }
}
