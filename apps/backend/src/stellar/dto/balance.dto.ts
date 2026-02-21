import { ApiProperty } from '@nestjs/swagger';

export class AssetBalanceDto {
  @ApiProperty({
    description:
      'Asset type (native for XLM, or credit_alphanum4/credit_alphanum12 for tokens)',
    example: 'native',
  })
  assetType: string;

  @ApiProperty({
    description: 'Asset code (for non-native assets)',
    example: 'USDC',
    required: false,
  })
  assetCode?: string;

  @ApiProperty({
    description: 'Asset issuer (for non-native assets)',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    required: false,
  })
  assetIssuer?: string;

  @ApiProperty({
    description: 'Balance amount as a string',
    example: '1000.0000000',
  })
  balance: string;

  @ApiProperty({
    description: 'Limit for the asset (for trustlines)',
    example: '922337203685.4775807',
    required: false,
  })
  limit?: string;

  @ApiProperty({
    description: 'Buying liabilities',
    example: '0.0000000',
    required: false,
  })
  buyingLiabilities?: string;

  @ApiProperty({
    description: 'Selling liabilities',
    example: '0.0000000',
    required: false,
  })
  sellingLiabilities?: string;
}

export class AccountBalancesDto {
  @ApiProperty({
    description: 'Stellar account public key',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  publicKey: string;

  @ApiProperty({
    description: 'List of asset balances',
    type: [AssetBalanceDto],
  })
  balances: AssetBalanceDto[];

  @ApiProperty({
    description: 'Sequence number of the account',
    example: '123456789',
    required: false,
  })
  sequenceNumber?: string;
}
