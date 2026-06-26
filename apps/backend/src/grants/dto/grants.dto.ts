import {
  IsString,
  IsNumber,
  IsPositive,
  IsInt,
  Min,
  IsArray,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRoundDto {
  @ApiProperty({
    description: 'Name of the grant round',
    example: 'Stellar Climate Fund Q2',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Stellar token address of the matching pool token',
    example: 'CDLZEA4RTA3AOF7UBNTQHFRJ67676767676767676767676767676767',
  })
  @IsString()
  tokenAddress: string;

  @ApiProperty({
    description: 'Start time of the round (unix timestamp in seconds)',
    example: 1774000000,
  })
  @IsNumber()
  @IsPositive()
  startTime: number;

  @ApiProperty({
    description: 'End time of the round (unix timestamp in seconds)',
    example: 1775000000,
  })
  @IsNumber()
  @IsPositive()
  endTime: number;
}

export class FundPoolDto {
  @ApiProperty({
    description: 'Stellar public key of the funder',
    example: 'G...FUNDER',
  })
  @IsString()
  funderPublicKey: string;

  @ApiProperty({ description: 'ID of the grant round', example: 1 })
  @IsNumber()
  @IsPositive()
  roundId: number;

  @ApiProperty({
    description: 'Amount to fund in stroops/decimal string',
    example: '100000',
  })
  @IsString()
  amount: string;
}

export class ApproveProjectDto {
  @ApiProperty({ description: 'ID of the grant round', example: 1 })
  @IsNumber()
  @IsInt()
  @Min(0)
  roundId: number;

  @ApiProperty({ description: 'ID of the project to approve', example: 42 })
  @IsNumber()
  @IsInt()
  @Min(0)
  projectId: number;
}

export class RecordContributionDto {
  @ApiProperty({ description: 'ID of the grant round', example: 1 })
  @IsNumber()
  @IsInt()
  @Min(0)
  roundId: number;

  @ApiProperty({ description: 'ID of the project contributed to', example: 42 })
  @IsNumber()
  @IsInt()
  @Min(0)
  projectId: number;

  @ApiProperty({
    description: 'Stellar public key of the contributor',
    example: 'G...CONTRIBUTOR',
  })
  @IsString()
  contributorPublicKey: string;

  @ApiProperty({ description: 'Amount contributed', example: '500' })
  @IsString()
  amount: string;
}

export class DistributeDto {
  @ApiProperty({ description: 'ID of the grant round', example: 1 })
  @IsNumber()
  @IsInt()
  @Min(0)
  roundId: number;

  @ApiProperty({
    description: 'Array of project owner Stellar public keys',
    example: ['G...OWNER1', 'G...OWNER2'],
  })
  @IsArray()
  @IsString({ each: true })
  projectOwners: string[];
}

// ── Response shapes ──────────────────────────────────────────────────────────

export class RoundDto {
  @ApiProperty({ description: 'Round ID', example: 1 })
  id: number;

  @ApiProperty({
    description: 'Name of the round',
    example: 'Stellar Climate Fund Q2',
  })
  name: string;

  @ApiProperty({
    description: 'Token asset address',
    example: 'CDLZEA4RTA3AOF7UBNTQHFRJ67676767676767676767676767676767',
  })
  tokenAddress: string;

  @ApiProperty({ description: 'Start time of the round', example: 1774000000 })
  startTime: number;

  @ApiProperty({ description: 'End time of the round', example: 1775000000 })
  endTime: number;

  @ApiProperty({
    description: 'Total amount in the matching pool',
    example: '250000',
  })
  totalPool: string;

  @ApiProperty({
    description: 'Whether the round is finalized',
    example: false,
  })
  isFinalized: boolean;

  @ApiProperty({
    description: 'Whether the pool has been distributed',
    example: false,
  })
  isDistributed: boolean;

  @ApiProperty({
    description: 'Current status of the round',
    example: 'ACTIVE',
  })
  status: string;
}

export class ProjectQfDto {
  @ApiProperty({ description: 'Project ID', example: 42 })
  projectId: number;

  @ApiProperty({
    description: 'Quadratic Funding (QF) score',
    example: '144.50',
  })
  qfScore: string;

  @ApiProperty({ description: 'Total contribution amount', example: '12000' })
  totalContributions: string;

  @ApiProperty({
    description: 'Total number of unique contributors',
    example: 25,
  })
  contributorCount: number;

  @ApiProperty({
    description: 'Estimated match amount from pool',
    example: '3500',
  })
  estimatedMatch: string;
}

export class ProjectAllocationDto extends ProjectQfDto {
  @ApiProperty({
    description: 'Percentage of total contributions',
    example: '15.5',
  })
  contributionPercentage: string;

  @ApiProperty({ description: 'Percentage of QF score', example: '20.2' })
  qfPercentage: string;

  @ApiProperty({
    description: 'Final allocation percentage from pool',
    example: '18.4',
  })
  allocationPercentage: string;
}

export class RoundParticipationMetricsDto {
  @ApiProperty({
    description: 'Total unique contributors in round',
    example: 150,
  })
  totalContributors: number;

  @ApiProperty({
    description: 'Total contribution amount raised',
    example: '75000',
  })
  totalContributionAmount: string;

  @ApiProperty({
    description: 'Total contribution transactions recorded',
    example: 180,
  })
  totalContributionRecords: number;

  @ApiProperty({
    description: 'Number of projects receiving contributions',
    example: 12,
  })
  totalProjectsWithContributions: number;

  @ApiProperty({
    description: 'Average contribution amount per contributor',
    example: '500',
  })
  averageContributionPerContributor: string;

  @ApiProperty({
    description: 'Average contribution amount per project',
    example: '6250',
  })
  averageContributionPerProject: string;
}

export class ContributionRecordDto {
  @ApiProperty({ description: 'Project ID', example: 42 })
  projectId: number;

  @ApiProperty({
    description: 'Stellar public key of the contributor',
    example: 'G...CONTRIBUTOR',
  })
  contributorPublicKey: string;

  @ApiProperty({ description: 'Contribution amount', example: '500' })
  amount: string;
}

export class RoundSummaryDto {
  @ApiProperty({ description: 'Details of the round', type: RoundDto })
  round: RoundDto;

  @ApiProperty({
    description: 'Current matching pool balance',
    example: '250000',
  })
  poolBalance: string;

  @ApiProperty({
    description: 'Round participation metrics',
    type: RoundParticipationMetricsDto,
  })
  participationMetrics: RoundParticipationMetricsDto;

  @ApiProperty({
    description: 'Allocations per project',
    type: [ProjectAllocationDto],
  })
  projects: ProjectAllocationDto[];
}

export class RoundExportDto extends RoundSummaryDto {
  @ApiProperty({
    description: 'List of all individual contributions in the round',
    type: [ContributionRecordDto],
  })
  contributions: ContributionRecordDto[];
}
