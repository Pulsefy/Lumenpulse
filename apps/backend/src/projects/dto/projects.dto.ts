import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsInt, IsOptional, IsEnum, IsBoolean, Min, Max, IsArray } from 'class-validator';
import { ProjectStatus } from '../entities/project.entity';

export class ProjectListQueryDto {
  @ApiProperty({
    description: 'Filter by project status',
    required: false,
    enum: ProjectStatus,
    example: ProjectStatus.Active,
  })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiProperty({
    description: 'Filter by owner public key',
    required: false,
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsOptional()
  @IsString()
  ownerPublicKey?: string;

  @ApiProperty({
    description: 'Filter by category',
    required: false,
    example: 'DeFi',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({
    description: 'Filter by tags (comma-separated)',
    required: false,
    example: 'stellar,defi',
  })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiProperty({
    description: 'Search query (matches name or description)',
    required: false,
    example: 'Lumen',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiProperty({
    description: 'Include on-chain state in response',
    required: false,
    default: true,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includeOnChain?: boolean;

  @ApiProperty({
    description: 'Pagination limit',
    required: false,
    default: 20,
    minimum: 1,
    maximum: 100,
    example: 20,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({
    description: 'Pagination offset',
    required: false,
    default: 0,
    minimum: 0,
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

export class OnChainStateDto {
  @ApiProperty({
    description: 'Smart contract address on-chain',
    example: 'CDLZEA4RTA3AOF7UBNTQHFRJ67676767676767676767676767676767',
  })
  contractAddress: string | null;

  @ApiProperty({
    description: 'Total funding received (in stroops)',
    example: '10000000',
  })
  totalFunding: string | null;

  @ApiProperty({
    description: 'Current vault balance (in stroops)',
    example: '5000000',
  })
  vaultBalance: string | null;

  @ApiProperty({
    description: 'Number of unique contributors',
    example: 25,
  })
  contributorCount: number | null;

  @ApiProperty({
    description: 'Last ledger where on-chain state was updated',
    example: '12345678',
  })
  lastUpdatedLedger: string | null;
}

export class ProjectListItemDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'LumenPulse Platform' })
  name: string;

  @ApiProperty({ example: 'Decentralized crypto news platform' })
  description: string | null;

  @ApiProperty({
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  ownerPublicKey: string;

  @ApiProperty({
    enum: ProjectStatus,
    example: ProjectStatus.Active,
  })
  status: ProjectStatus;

  @ApiProperty({
    description: 'On-chain state (included by default)',
    type: OnChainStateDto,
    required: false,
  })
  onChainState?: OnChainStateDto;

  @ApiProperty({ example: 'https://lumenpulse.com' })
  websiteUrl: string | null;

  @ApiProperty({ example: 'https://github.com/lumenpulse' })
  githubUrl: string | null;

  @ApiProperty({ example: ['stellar', 'defi', 'news'] })
  tags: string[] | null;

  @ApiProperty({ example: 'DeFi' })
  category: string | null;

  @ApiProperty({ example: '2024-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2024-01-15T00:00:00Z' })
  updatedAt: Date;

  @ApiProperty({ example: '2024-12-31T23:59:59Z' })
  expiresAt: Date | null;

  @ApiProperty({ example: '2024-01-10T00:00:00Z' })
  verifiedAt: Date | null;
}

export class ProjectListResponseDto {
  @ApiProperty({ type: [ProjectListItemDto] })
  projects: ProjectListItemDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 0 })
  offset: number;
}

export class ProjectDetailDto extends ProjectListItemDto {
  @ApiProperty({
    description: 'Additional metadata (JSON object)',
    example: { version: '1.0.0', license: 'MIT' },
  })
  metadata: Record<string, unknown> | null;

  declare onChainState: OnChainStateDto;
}
