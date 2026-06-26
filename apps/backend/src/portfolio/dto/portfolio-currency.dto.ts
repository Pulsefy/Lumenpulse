import { IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum CurrencyCode {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  NGN = 'NGN',
  XLM = 'XLM',
}

export class GetPortfolioSummaryQueryDto {
  @ApiPropertyOptional({
    description: 'Target currency for portfolio valuation',
    enum: CurrencyCode,
    default: 'USD',
    example: 'EUR',
  })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode = CurrencyCode.USD;
}

export class AssetBalanceWithCurrencyDto {
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

  @ApiProperty({
    description: 'Value in the requested currency',
    example: 567.89,
  })
  value: number;

  @ApiProperty({
    description: 'Value in USD (for reference)',
    example: 567.89,
  })
  valueUsd: number;
}

export class PortfolioSummaryWithCurrencyResponseDto {
  @ApiProperty({
    description: 'Total portfolio value in the requested currency',
    example: '15420.50',
  })
  totalValue: string;

  @ApiProperty({
    description: 'Currency code',
    enum: CurrencyCode,
    example: 'EUR',
  })
  currency: CurrencyCode;

  @ApiProperty({
    description: 'Total value in USD (for reference)',
    example: '15420.50',
  })
  totalValueUsd: string;

  @ApiProperty({
    description: 'Individual asset balances with values in requested currency',
    type: [AssetBalanceWithCurrencyDto],
  })
  assets: AssetBalanceWithCurrencyDto[];

  @ApiProperty({
    description: 'Timestamp of the last recorded snapshot',
    nullable: true,
    example: '2024-02-25T15:30:00Z',
  })
  lastUpdated: Date | null;

  @ApiProperty({
    description:
      'Indicates whether the user has a linked Stellar account with snapshots',
    example: true,
  })
  hasLinkedAccount: boolean;

  @ApiProperty({
    description:
      'Exchange rate applied for conversion (from USD to target currency)',
    example: 0.92,
  })
  exchangeRate: number;
}
