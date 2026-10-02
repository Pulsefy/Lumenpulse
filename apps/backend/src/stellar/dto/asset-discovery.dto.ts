import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto, PaginationMetaDto } from '../../common/pagination';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AssetDto {
  @ApiProperty({
    description: 'Asset code',
    example: 'USDC',
  })
  assetCode: string;

  @ApiProperty({
    description: 'Asset issuer',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  assetIssuer: string;

  @ApiProperty({
    description: 'Asset type',
    example: 'credit_alphanum4',
  })
  assetType: string;

  @ApiProperty({
    description: 'Number of accounts holding this asset',
    example: '1000',
    required: false,
  })
  numAccounts?: number;

  @ApiProperty({
    description: 'Total supply of the asset',
    example: '1000000.0000000',
    required: false,
  })
  totalSupply?: string;

  @ApiProperty({
    description: 'Asset flags indicating special permissions',
    required: false,
  })
  flags?: {
    authRequired: boolean;
    authRevocable: boolean;
    authImmutable: boolean;
  };
}

export class AssetDiscoveryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Asset code to search for (exact match)',
    example: 'USDC',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assetCode?: string;

  @ApiPropertyOptional({
    description: 'Asset issuer to search for (exact match)',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  issuer?: string;

  @ApiPropertyOptional({
    description: 'General search query (partial match on asset code)',
    example: 'USD',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  q?: string;
  q?: string;

  @ApiProperty({
    description: 'Limit number of results',
    example: 10,
    minimum: 1,
    maximum: 100,
    default: 10,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({
    description: 'Cursor for pagination',
    example: '123456789',
    required: false,
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class AssetDiscoveryResponseDto {
  @ApiProperty({
    description: 'List of assets matching the query',
    type: [AssetDto],
  })
  assets: AssetDto[];

  @ApiProperty({
    description: 'Next cursor for pagination',
    required: false,
  })
  nextCursor?: string;

  @ApiProperty({
    description: 'Total number of results (if available)',
    required: false,
  })
  total?: number;

  @ApiProperty({
    description: 'Indicates if there are more results',
    example: true,
  })
  hasMore: boolean;

  @ApiProperty({
    description: 'Standard pagination metadata',
    type: PaginationMetaDto,
  })
  meta: PaginationMetaDto;
}
