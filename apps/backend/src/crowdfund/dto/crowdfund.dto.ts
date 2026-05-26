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
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsString()
  targetDate: string;
}

export class CreateProjectDto {
  @IsString()
  owner: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  bannerUrl?: string;

  @IsString()
  targetAmount: string;

  @IsString()
  tokenAddress: string;

  @IsOptional()
  @IsString()
  contractAddress?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRoadmapItemDto)
  roadmap?: CreateRoadmapItemDto[];
}

export class ContributeDto {
  @IsNumber()
  @IsInt()
  @Min(1)
  projectId: number;

  @IsString()
  amount: string;

  @IsString()
  senderPublicKey: string;
}

// ── Response shapes ──────────────────────────────────────────────────────────

export class RoadmapItemDto {
  id: string;
  title: string;
  description: string;
  targetDate: string;
  isCompleted: boolean;
}

export class CrowdfundProjectDto {
  id: number;
  owner: string;
  name: string;
  description?: string;
  bannerUrl?: string;
  targetAmount: string;
  tokenAddress: string;
  contractAddress?: string;
  totalDeposited: string;
  totalWithdrawn: string;
  isActive: boolean;
  onChainStatus: OnChainStatus;
  lastSyncedAt: string;
  contributorCount: number;
  roadmap: RoadmapItemDto[];
  createdAt: string;
}

export class ContributorDto {
  publicKey: string;
  totalContributed: string;
  contributionCount: number;
  lastContributionAt: string;
}

export class ContributionResponseDto {
  transactionHash: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  ledger?: number;
  message?: string;
}

export class ContributionRecordDto {
  projectId: number;
  contributor: string;
  amount: string;
  timestamp: string;
  transactionHash: string;
}
