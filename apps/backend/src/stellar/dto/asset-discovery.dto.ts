import { ApiProperty } from '@nestjs/swagger';

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

export class AssetDiscoveryQueryDto {
  @ApiProperty({
    description: 'Asset code to search for (exact match)',
    example: 'USDC',
    required: false,
  })
  assetCode?: string;

  @ApiProperty({
    description: 'Asset issuer to search for (exact match)',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    required: false,
  })
  issuer?: string;

  @ApiProperty({
    description: 'General search query (partial match on asset code)',
    example: 'USD',
    required: false,
  })
  q?: string;

  @ApiProperty({
    description: 'Limit number of results',
    example: 10,
    minimum: 1,
    maximum: 100,
    default: 10,
    required: false,
  })
  limit?: number;

  @ApiProperty({
    description: 'Cursor for pagination',
    example: '123456789',
    required: false,
  })
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
}
