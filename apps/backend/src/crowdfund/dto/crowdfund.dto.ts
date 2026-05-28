import {
  IsString,
  IsNumber,
  IsOptional,
  IsInt,
  Min,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── Enums ────────────────────────────────────────────────────────────────────

export enum OnChainStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  PENDING = 'PENDING',
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

export class CreateRoadmapItemDto {
  @ApiProperty({
    description: 'Title of the roadmap milestone',
    example: 'Soroban Contract Audit',
  })
  @IsString()
  title: string;

  @ApiProperty({
    description: 'Detailed description of the milestone',
    example: 'Independent security audit of the smart contracts.',
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'Target date of completion (ISO or format string)',
    example: '2026-12-31',
  })
  @IsString()
  targetDate: string;
}

export class CreateProjectDto {
  @ApiProperty({
    description: 'Stellar public key of the project owner',
    example: 'G...OWNER',
  })
  @IsString()
  owner: string;

  @ApiProperty({
    description: 'Name of the project',
    example: 'BridgeWise Ingestion Hardening',
  })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    description: 'Detailed description of the project',
    example: 'Hardening the ingestion layer against transient failures.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'URL of the project banner image',
    example: 'https://example.com/banner.png',
  })
  @IsOptional()
  @IsString()
  bannerUrl?: string;

  @ApiProperty({
    description: 'Target funding amount in stroops or decimal string',
    example: '50000',
  })
  @IsString()
  targetAmount: string;

  @ApiProperty({
    description: 'Stellar token asset address used for funding',
    example: 'CDLZEA4RTA3AOF7UBNTQHFRJ67676767676767676767676767676767',
  })
  @IsString()
  tokenAddress: string;

  @ApiPropertyOptional({
    description: 'Stellar smart contract address of the crowdfund vault',
    example: 'CC...VAULT',
  })
  @IsOptional()
  @IsString()
  contractAddress?: string;

  @ApiPropertyOptional({
    description: 'Roadmap milestones for the project',
    type: [CreateRoadmapItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoadmapItemDto)
  roadmap?: CreateRoadmapItemDto[];
}

export class ContributeDto {
  @ApiProperty({
    description: 'ID of the project to contribute to',
    example: 1,
  })
  @IsNumber()
  @IsInt()
  @Min(1)
  projectId: number;

  @ApiProperty({
    description: 'Amount to contribute as a string',
    example: '1000',
  })
  @IsString()
  amount: string;

  @ApiProperty({
    description: 'Stellar public key of the contributor',
    example: 'G...SENDER',
  })
  @IsString()
  senderPublicKey: string;
}

// ── Response shapes ──────────────────────────────────────────────────────────

export class RoadmapItemDto {
  @ApiProperty({ description: 'Milestone ID', example: 'rm_123' })
  id: string;

  @ApiProperty({
    description: 'Title of the roadmap milestone',
    example: 'Soroban Contract Audit',
  })
  title: string;

  @ApiProperty({
    description: 'Detailed description of the milestone',
    example: 'Independent security audit of the smart contracts.',
  })
  description: string;

  @ApiProperty({
    description: 'Target date of completion',
    example: '2026-12-31',
  })
  targetDate: string;

  @ApiProperty({ description: 'Completion status', example: false })
  isCompleted: boolean;
}

export class CrowdfundProjectDto {
  @ApiProperty({ description: 'Project ID', example: 1 })
  id: number;

  @ApiProperty({
    description: 'Stellar public key of the project owner',
    example: 'G...OWNER',
  })
  owner: string;

  @ApiProperty({
    description: 'Name of the project',
    example: 'BridgeWise Ingestion Hardening',
  })
  name: string;

  @ApiPropertyOptional({
    description: 'Detailed description of the project',
    example: 'Hardening the ingestion layer against transient failures.',
  })
  description?: string;

  @ApiPropertyOptional({
    description: 'URL of the project banner image',
    example: 'https://example.com/banner.png',
  })
  bannerUrl?: string;

  @ApiProperty({ description: 'Target funding amount', example: '50000' })
  targetAmount: string;

  @ApiProperty({
    description: 'Stellar token asset address used for funding',
    example: 'CDLZEA4RTA3AOF7UBNTQHFRJ67676767676767676767676767676767',
  })
  tokenAddress: string;

  @ApiPropertyOptional({
    description: 'Stellar smart contract address of the crowdfund vault',
    example: 'CC...VAULT',
  })
  contractAddress?: string;

  @ApiProperty({
    description: 'Total deposited/contributed amount',
    example: '15000',
  })
  totalDeposited: string;

  @ApiProperty({ description: 'Total withdrawn amount', example: '0' })
  totalWithdrawn: string;

  @ApiProperty({
    description: 'Whether the project is currently active',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'On-chain project status',
    enum: OnChainStatus,
    example: OnChainStatus.ACTIVE,
  })
  onChainStatus: OnChainStatus;

  @ApiProperty({
    description: 'Timestamp of the last sync with the ledger',
    example: '2026-05-27T20:58:35Z',
  })
  lastSyncedAt: string;

  @ApiProperty({ description: 'Number of unique contributors', example: 12 })
  contributorCount: number;

  @ApiProperty({
    description: 'Roadmap milestones list',
    type: [RoadmapItemDto],
  })
  roadmap: RoadmapItemDto[];

  @ApiProperty({
    description: 'Timestamp of project creation',
    example: '2026-05-27T20:58:35Z',
  })
  createdAt: string;
}

export class ContributorDto {
  @ApiProperty({
    description: 'Stellar public key of the contributor',
    example: 'G...CONTRIBUTOR',
  })
  publicKey: string;

  @ApiProperty({
    description: 'Total contributed amount across all transactions',
    example: '5000',
  })
  totalContributed: string;

  @ApiProperty({ description: 'Number of contributions made', example: 3 })
  contributionCount: number;

  @ApiProperty({
    description: 'Timestamp of the last contribution',
    example: '2026-05-27T20:58:35Z',
  })
  lastContributionAt: string;
}

export class ContributionResponseDto {
  @ApiProperty({
    description: 'Hash of the transaction submitted to the Stellar network',
    example: 'a1b2c3d4...',
  })
  transactionHash: string;

  @ApiProperty({
    description: 'Status of the contribution on ledger',
    example: 'SUCCESS',
  })
  status: 'SUCCESS' | 'FAILED' | 'PENDING';

  @ApiPropertyOptional({
    description: 'Stellar ledger sequence number containing the transaction',
    example: 123456,
  })
  ledger?: number;

  @ApiPropertyOptional({
    description: 'Optional feedback or error message',
    example: 'Contribution successful',
  })
  message?: string;
}

export class ContributionRecordDto {
  @ApiProperty({ description: 'Project ID', example: 1 })
  projectId: number;

  @ApiProperty({
    description: 'Stellar public key of the contributor',
    example: 'G...CONTRIBUTOR',
  })
  contributor: string;

  @ApiProperty({ description: 'Contributed amount', example: '1000' })
  amount: string;

  @ApiProperty({
    description: 'Timestamp of the contribution',
    example: '2026-05-27T20:58:35Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Hash of the transaction',
    example: 'a1b2c3d4...',
  })
  transactionHash: string;
}
