import { IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AssetBalanceDto {
  assetCode: string;
  assetIssuer: string | null;
  amount: string;
  valueUsd: number;
}

export class PortfolioSnapshotDto {
  id: string;
  userId: string;
  createdAt: Date;
  assetBalances: AssetBalanceDto[];
  totalValueUsd: string;
}

export class GetPortfolioHistoryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 10;
}

export class PortfolioHistoryResponseDto {
  snapshots: PortfolioSnapshotDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
