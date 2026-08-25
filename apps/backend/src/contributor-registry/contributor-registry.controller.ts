import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  Request,
  Logger,
  HttpCode,
  HttpStatus,
  UsePipes,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  getRegistryReadThrottleOverride,
  getRegistryWriteThrottleOverride,
} from '../common/rate-limit/rate-limit.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContractAdminGuard } from '../common/guards/contract-admin.guard';
import { ContractAdminAuditService } from '../contract-admin/contract-admin-audit.service';
import { Roles } from '../auth/decorators/auth.decorators';
import { UserRole } from '../users/entities/user.entity';
import { ContributorRegistryService } from './contributor-registry.service';
import {
  ContributorResponseDto,
  NonceResponseDto,
  RegisterContributorDto,
  RegisterWithSigDto,
  RegistrationXdrResponseDto,
  ReputationResponseDto,
  SubmitResponseDto,
} from './dto/contributor-registry.dto';
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

@ApiTags('contributor-registry')
@Controller('contributor-registry')
@UsePipes(CustomValidationPipe)
export class ContributorRegistryController {
  private readonly logger = new Logger(ContributorRegistryController.name);

  constructor(
    private readonly svc: ContributorRegistryService,
    private readonly auditService: ContractAdminAuditService,
  ) {}

  // ── Registration (Admin Only) ──────────────────────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(getRegistryWriteThrottleOverride())
  @UseGuards(JwtAuthGuard, ContractAdminGuard)
  @Roles(UserRole.ADMIN)
  @AuditBlockchainAction({ contractField: 'address' })
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Register a contributor (admin only)',
    description:
      'In mock mode: immediately stores the contributor and returns a placeholder XDR. ' +
      'In real mode: builds an unsigned Soroban transaction XDR that the contributor ' +
      'must sign with their Stellar wallet and submit independently.',
  })
  @ApiResponse({
    status: 201,
    description: 'Registration XDR built (or contributor stored in mock mode)',
    type: RegistrationXdrResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request parameters',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({
    status: 409,
    description: 'Contributor already registered or handle taken',
  })
  async register(
    @Body() dto: RegisterContributorDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<RegistrationXdrResponseDto> {
    const user = req.user!;
    this.logger.log(
      `Admin ${user.id} registering contributor: ${dto.githubHandle}`,
    );

    // Log the blockchain operation
    await this.auditService.logBlockchainOperation(
      {
        actorId: user.id,
        actorEmail: user.email,
        endpoint: 'POST /contributor-registry/register',
        targetContract: 'contributor-registry',
        paramsSummary: {
          address: dto.address,
          githubHandle: dto.githubHandle,
        },
        responseStatus: HttpStatus.CREATED,
      },
      req as ExpressRequest,
    );

    return this.svc.buildRegistrationXdr(dto);
  }

  @Post('register-with-sig')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(getRegistryWriteThrottleOverride())
  @UseGuards(JwtAuthGuard, ContractAdminGuard)
  @Roles(UserRole.ADMIN)
  @AuditBlockchainAction({ contractField: 'address' })
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Gasless contributor registration (admin only)',
    description:
      'The contributor signs a SorobanAuthorizationEntry off-chain (no XLM required). ' +
      'The server (relayer) builds the transaction, attaches the signed entry, and ' +
      'submits it — paying the network fees. ' +
      'Obtain the current nonce first via GET /contributor-registry/nonce/:address.',
  })
  @ApiResponse({
    status: 201,
    description: 'Transaction submitted successfully',
    type: SubmitResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid signed auth entry or contract not configured',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({
    status: 409,
    description: 'Contributor already registered or handle taken',
  })
  async registerWithSig(
    @Body() dto: RegisterWithSigDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<SubmitResponseDto> {
    const user = req.user!;
    this.logger.log(
      `Admin ${user.id} processing gasless registration for: ${dto.address}`,
    );

    // Log the blockchain operation
    await this.auditService.logBlockchainOperation(
      {
        actorId: user.id,
        actorEmail: user.email,
        endpoint: 'POST /contributor-registry/register-with-sig',
        targetContract: 'contributor-registry',
        paramsSummary: {
          address: dto.address,
          githubHandle: dto.githubHandle,
          hasSignature: !!dto.signatureHex,
        },
        responseStatus: HttpStatus.CREATED,
      },
      req as ExpressRequest,
    );

    return this.svc.registerWithSignature(dto);
  }

  // ── Lookups (Public - No Auth Required) ───────────────────────────────────

  @Get('wallet/:address')
  @Throttle(getRegistryReadThrottleOverride())
  @ApiOperation({
    summary: 'Look up contributor by Stellar wallet address',
    description:
      'Returns contributor profile. Result is cached for 60 seconds.',
  })
  @ApiParam({
    name: 'address',
    example: 'GABC1234...',
    description: 'Stellar public key (G...)',
  })
  @ApiResponse({
    status: 200,
    description: 'Contributor profile',
    type: ContributorResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Contributor not found' })
  async getByAddress(
    @Param('address') address: string,
  ): Promise<ContributorResponseDto> {
    return this.svc.getContributorByAddress(address);
  }

  @Get('github/:handle')
  @Throttle(getRegistryReadThrottleOverride())
  @ApiOperation({
    summary: 'Look up contributor by GitHub handle',
    description:
      'Returns contributor profile. Result is cached for 60 seconds.',
  })
  @ApiParam({
    name: 'handle',
    example: 'octocat',
    description: 'GitHub username',
  })
  @ApiResponse({
    status: 200,
    description: 'Contributor profile',
    type: ContributorResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Contributor not found' })
  async getByGithub(
    @Param('handle') handle: string,
  ): Promise<ContributorResponseDto> {
    return this.svc.getContributorByGithub(handle);
  }

  // ── Reputation (Public - No Auth Required) ──────────────────────────────

  @Get('reputation/:address')
  @Throttle(getRegistryReadThrottleOverride())
  @ApiOperation({
    summary: 'Read contributor reputation score and tier',
    description:
      'Returns the on-chain reputation score and derived tier. ' +
      'Result is cached for 60 seconds to reduce RPC load.',
  })
  @ApiParam({
    name: 'address',
    example: 'GABC1234...',
    description: 'Stellar public key (G...)',
  })
  @ApiResponse({
    status: 200,
    description: 'Reputation data',
    type: ReputationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Contributor not found' })
  async getReputation(
    @Param('address') address: string,
  ): Promise<ReputationResponseDto> {
    return this.svc.getReputation(address);
  }

  // ── Nonce (Public - No Auth Required) ────────────────────────────────────

  @Get('nonce/:address')
  @Throttle(getRegistryReadThrottleOverride())
  @ApiOperation({
    summary: 'Get registration nonce for off-chain signing',
    description:
      'Returns the current per-address nonce required when building the ' +
      'SorobanAuthorizationEntry for register_contributor_with_sig. ' +
      'Cached for 5 seconds only — always fetch immediately before signing.',
  })
  @ApiParam({
    name: 'address',
    example: 'GABC1234...',
    description: 'Stellar public key (G...)',
  })
  @ApiResponse({
    status: 200,
    description: 'Current nonce',
    type: NonceResponseDto,
  })
  async getNonce(@Param('address') address: string): Promise<NonceResponseDto> {
    return this.svc.getNonce(address);
  }
}
