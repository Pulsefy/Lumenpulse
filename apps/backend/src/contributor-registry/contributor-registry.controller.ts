import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  getRegistryReadThrottleOverride,
  getRegistryWriteThrottleOverride,
} from '../common/rate-limit/rate-limit.config';
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

@ApiTags('contributor-registry')
@Controller('contributor-registry')
export class ContributorRegistryController {
  constructor(private readonly svc: ContributorRegistryService) {}

  // ── Registration ──────────────────────────────────────────────────────────────

  @Post('register')
  @Throttle(getRegistryWriteThrottleOverride())
  @ApiOperation({
    summary: 'Register a contributor (direct)',
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
  @ApiResponse({ status: 400, description: 'Contract not configured or invalid input' })
  @ApiResponse({ status: 409, description: 'Contributor already registered or handle taken' })
  register(@Body() dto: RegisterContributorDto): Promise<RegistrationXdrResponseDto> {
    return this.svc.buildRegistrationXdr(dto);
  }

  @Post('register-with-sig')
  @Throttle(getRegistryWriteThrottleOverride())
  @ApiOperation({
    summary: 'Gasless contributor registration (testnet signing + submission)',
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
  @ApiResponse({ status: 400, description: 'Invalid signed auth entry or contract not configured' })
  @ApiResponse({ status: 409, description: 'Contributor already registered or handle taken' })
  registerWithSig(@Body() dto: RegisterWithSigDto): Promise<SubmitResponseDto> {
    return this.svc.registerWithSignature(dto);
  }

  // ── Lookups ───────────────────────────────────────────────────────────────────

  @Get('wallet/:address')
  @Throttle(getRegistryReadThrottleOverride())
  @ApiOperation({
    summary: 'Look up contributor by Stellar wallet address',
    description: 'Returns contributor profile. Result is cached for 60 seconds.',
  })
  @ApiParam({ name: 'address', example: 'GABC1234...', description: 'Stellar public key (G...)' })
  @ApiResponse({
    status: 200,
    description: 'Contributor profile',
    type: ContributorResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Contributor not found' })
  getByAddress(@Param('address') address: string): Promise<ContributorResponseDto> {
    return this.svc.getContributorByAddress(address);
  }

  @Get('github/:handle')
  @Throttle(getRegistryReadThrottleOverride())
  @ApiOperation({
    summary: 'Look up contributor by GitHub handle',
    description: 'Returns contributor profile. Result is cached for 60 seconds.',
  })
  @ApiParam({ name: 'handle', example: 'octocat', description: 'GitHub username' })
  @ApiResponse({
    status: 200,
    description: 'Contributor profile',
    type: ContributorResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Contributor not found' })
  getByGithub(@Param('handle') handle: string): Promise<ContributorResponseDto> {
    return this.svc.getContributorByGithub(handle);
  }

  // ── Reputation ────────────────────────────────────────────────────────────────

  @Get('reputation/:address')
  @Throttle(getRegistryReadThrottleOverride())
  @ApiOperation({
    summary: 'Read contributor reputation score and tier',
    description:
      'Returns the on-chain reputation score and derived tier. ' +
      'Result is cached for 60 seconds to reduce RPC load.',
  })
  @ApiParam({ name: 'address', example: 'GABC1234...', description: 'Stellar public key (G...)' })
  @ApiResponse({
    status: 200,
    description: 'Reputation data',
    type: ReputationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Contributor not found' })
  getReputation(@Param('address') address: string): Promise<ReputationResponseDto> {
    return this.svc.getReputation(address);
  }

  // ── Nonce ─────────────────────────────────────────────────────────────────────

  @Get('nonce/:address')
  @Throttle(getRegistryReadThrottleOverride())
  @ApiOperation({
    summary: 'Get registration nonce for off-chain signing',
    description:
      'Returns the current per-address nonce required when building the ' +
      'SorobanAuthorizationEntry for register_contributor_with_sig. ' +
      'Cached for 5 seconds only — always fetch immediately before signing.',
  })
  @ApiParam({ name: 'address', example: 'GABC1234...', description: 'Stellar public key (G...)' })
  @ApiResponse({
    status: 200,
    description: 'Current nonce',
    type: NonceResponseDto,
  })
  getNonce(@Param('address') address: string): Promise<NonceResponseDto> {
    return this.svc.getNonce(address);
  }
}
