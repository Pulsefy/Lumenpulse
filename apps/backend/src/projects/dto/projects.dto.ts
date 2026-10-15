import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ProjectStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export class ProjectListQueryDto {
  @ApiPropertyOptional({ description: 'Filter by project status' })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({ description: 'Filter by owner address' })
  @IsOptional()
  @IsString()
  owner?: string;

  @ApiPropertyOptional({ description: 'Page number (1-indexed)', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({ description: 'Sort field', default: 'createdAt' })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ description: 'Sort direction', default: 'DESC' })
  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}

export class VaultStateDto {
  @ApiProperty({ description: 'Total deposited amount in stroops' })
  totalDeposited: string;

  @ApiProperty({ description: 'Total withdrawn amount in stroops' })
  totalWithdrawn: string;

  @ApiProperty({ description: 'Current vault balance in stroops' })
  currentBalance: string;

  @ApiProperty({ description: 'Number of unique contributors' })
  contributorCount: number;

  @ApiProperty({ description: 'Last ledger sequence synced' })
  lastLedgerSeq: number;
}

export class OnChainStatusDto {
  @ApiProperty({ description: 'Project status from chain' })
  status: ProjectStatus;

  @ApiProperty({ description: 'Vault state information' })
  vault: VaultStateDto;

  @ApiProperty({ description: 'Last transaction hash' })
  lastTxHash: string;

  @ApiProperty({ description: 'Last sync timestamp' })
  lastSyncedAt: Date;
}

export class ProjectMetadataDto {
  @ApiProperty({ description: 'Project name' })
  name: string;

  @ApiProperty({ description: 'Project description' })
  description?: string;

  @ApiProperty({ description: 'Banner image URL' })
  bannerUrl?: string;

  @ApiProperty({ description: 'Project category' })
  category?: string;

  @ApiProperty({ description: 'Project tags' })
  tags?: string[];

  @ApiProperty({ description: 'Project website URL' })
  websiteUrl?: string;

  @ApiProperty({ description: 'Social media links' })
  socialLinks?: Record<string, string>;
}

export class ProjectListItemDto {
  @ApiProperty({ description: 'Project ID' })
  projectId: string;

  @ApiProperty({ description: 'Owner address' })
  owner: string;

  @ApiProperty({ description: 'Project metadata' })
  metadata: ProjectMetadataDto;

  @ApiProperty({ description: 'On-chain status' })
  onChainStatus: OnChainStatusDto;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}

export class ProjectDetailDto extends ProjectListItemDto {
  @ApiProperty({ description: 'Full project metadata CID' })
  metadataCid: string;

  @ApiProperty({ description: 'Contract address' })
  contractAddress?: string;

  @ApiProperty({ description: 'Token address' })
  tokenAddress?: string;

  @ApiProperty({ description: 'Target amount in stroops' })
  targetAmount?: string;

  @ApiProperty({ description: 'Project milestones' })
  milestones?: Array<{
    id: string;
    title: string;
    description?: string;
    targetDate?: Date;
    isCompleted: boolean;
  }>;
}

export class ProjectListResponseDto {
  @ApiProperty({ description: 'Array of projects' })
  projects: ProjectListItemDto[];

  @ApiProperty({ description: 'Total number of projects' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;
}
