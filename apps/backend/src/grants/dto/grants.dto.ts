import {
  IsString,
  IsNumber,
  IsPositive,
  IsInt,
  Min,
  IsArray,
} from 'class-validator';

export class CreateRoundDto {
  @IsString()
  name: string;

  @IsString()
  tokenAddress: string;

  @IsNumber()
  @IsPositive()
  startTime: number; // unix timestamp

  @IsNumber()
  @IsPositive()
  endTime: number;
}

export class FundPoolDto {
  @IsString()
  funderPublicKey: string;

  @IsNumber()
  @IsPositive()
  roundId: number;

  @IsString()
  amount: string;
}

export class ApproveProjectDto {
  @IsNumber()
  @IsInt()
  @Min(0)
  roundId: number;

  @IsNumber()
  @IsInt()
  @Min(0)
  projectId: number;
}

export class RecordContributionDto {
  @IsNumber()
  @IsInt()
  @Min(0)
  roundId: number;

  @IsNumber()
  @IsInt()
  @Min(0)
  projectId: number;

  @IsString()
  contributorPublicKey: string;

  @IsString()
  amount: string;
}

export class DistributeDto {
  @IsNumber()
  @IsInt()
  @Min(0)
  roundId: number;

  @IsArray()
  @IsString({ each: true })
  projectOwners: string[];
}

// ── Response shapes ──────────────────────────────────────────────────────────

export interface RoundDto {
  id: number;
  name: string;
  tokenAddress: string;
  startTime: number;
  endTime: number;
  totalPool: string;
  isFinalized: boolean;
  isDistributed: boolean;
  status: string;
}

export interface ProjectQfDto {
  projectId: number;
  qfScore: string;
  totalContributions: string;
  contributorCount: number;
  estimatedMatch: string;
}

export interface RoundSummaryDto {
  round: RoundDto;
  poolBalance: string;
  projects: ProjectQfDto[];
}
