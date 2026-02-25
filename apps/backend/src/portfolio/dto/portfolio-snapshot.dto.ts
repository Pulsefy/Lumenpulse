import { IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssetBalanceDto {
  @ApiProperty({ description: 'Asset code', example: 'XLM' })
  assetCode: string;

  @ApiProperty({
    description: 'Asset issuer public key',
    example: 'GCZJM35NKGVK47BB4SPBDV25477PZYIYPVVG453LPYFNXLS3FGHDXOCM',
    nullable: true,
  })
  assetIssuer: string | null;

  @ApiProperty({ description: 'Asset amount', example: '1234.5678' })
  amount: string;

  @ApiProperty({ description: 'Value in USD', example: 567.89 })
  valueUsd: number;
}

export class PortfolioSnapshotDto {
  @ApiProperty({
    description: 'Snapshot ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({ description: 'User ID', example: 'user-123' })
  userId: string;

  @ApiProperty({
    description: 'Snapshot creation timestamp',
    example: '2024-02-25T15:30:00Z',
  })
  createdAt: Date;

  @ApiProperty({ description: 'Asset balances', type: [AssetBalanceDto] })
  assetBalances: AssetBalanceDto[];

  @ApiProperty({
    description: 'Total portfolio value in USD',
    example: '15420.50',
  })
  totalValueUsd: string;
}

export class GetPortfolioHistoryDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: 1,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 10,
    minimum: 1,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 10;
}

export class PortfolioHistoryResponseDto {
  @ApiProperty({
    description: 'List of portfolio snapshots',
    type: [PortfolioSnapshotDto],
  })
  snapshots: PortfolioSnapshotDto[];

  @ApiProperty({ description: 'Total number of snapshots', example: 150 })
  total: number;

  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Items per page', example: 10 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages', example: 15 })
  totalPages: number;
}
