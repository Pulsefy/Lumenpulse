import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  IsInt,
  Min,
  Max,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDeploymentManifestDto {
  @ApiProperty({
    description: 'Target environment',
    example: 'testnet',
    default: 'testnet',
  })
  @IsString()
  @IsNotEmpty()
  environment: string;

  @ApiPropertyOptional({
    description: 'Release version tag',
    example: 'v1.2.0',
  })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiProperty({
    description: 'Contract deployment records keyed by contract name',
    example: {
      contributor_registry: {
        id: 'CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB',
        wasm_hash:
          '4a25619b8fea02f3447e7b700e2f2b0ed575f62679006ddc981009b26d9d5e71',
      },
    },
  })
  @IsObject()
  contracts: Record<string, any>;

  @ApiPropertyOptional({
    description:
      'Environment metadata (RPC URL, admin addresses, deployment notes)',
    example: { rpc_url: 'https://soroban-testnet.stellar.org:443' },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Mark this manifest as active for the specified environment',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDeploymentManifestDto {
  @ApiPropertyOptional({
    description: 'Target environment',
    example: 'testnet',
  })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({
    description: 'Release version tag',
    example: 'v1.2.1',
  })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiPropertyOptional({ description: 'Contract deployment records' })
  @IsOptional()
  @IsObject()
  contracts?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Environment metadata' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Mark this manifest as active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryDeploymentManifestDto {
  @ApiPropertyOptional({
    description: 'Filter by environment',
    example: 'testnet',
  })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class DeploymentManifestResponseDto {
  @ApiProperty({ example: '3a2b1c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d' })
  id: string;

  @ApiProperty({ example: 'testnet' })
  environment: string;

  @ApiPropertyOptional({ example: 'v1.0.0', nullable: true })
  version: string | null;

  @ApiProperty({
    example: {
      contributor_registry: {
        id: 'CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB',
      },
    },
  })
  contracts: Record<string, any>;

  @ApiPropertyOptional({ nullable: true })
  metadata: Record<string, any> | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiPropertyOptional({ example: 'user-uuid-123', nullable: true })
  createdBy: string | null;

  @ApiProperty({ example: '2026-07-26T05:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-07-26T05:00:00.000Z' })
  updatedAt: Date;
}

export class DeploymentManifestListResponseDto {
  @ApiProperty({ type: [DeploymentManifestResponseDto] })
  data: DeploymentManifestResponseDto[];

  @ApiProperty({ example: 1 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
