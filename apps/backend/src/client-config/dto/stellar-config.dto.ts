import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Client-safe Stellar / Soroban configuration.
 *
 * Only non-secret values are included here — this response is public and
 * cached by the frontend on startup.  Never add secrets (private keys,
 * JWT secrets, DB credentials, etc.) to this DTO.
 */
export class StellarConfigDto {
  @ApiProperty({
    description: 'Stellar network identifier',
    enum: ['testnet', 'mainnet'],
    example: 'testnet',
  })
  network!: 'testnet' | 'mainnet';

  @ApiProperty({
    description: 'Stellar Horizon REST API base URL',
    example: 'https://horizon-testnet.stellar.org',
  })
  horizonUrl!: string;

  @ApiProperty({
    description: 'Soroban RPC endpoint URL',
    example: 'https://soroban-testnet.stellar.org',
  })
  sorobanRpcUrl!: string;

  @ApiPropertyOptional({
    description:
      'Soroban contract ID for the crowdfund contract. Null when not yet deployed.',
    example: 'CABL2E2NKLCQIRSF6BXVB4NLSDBNJ2QBFVGXNLGBMZFDWRQKQ7MWDKD',
    nullable: true,
  })
  crowdfundContractId!: string | null;

  @ApiProperty({
    description: 'Stellar block-explorer base URL',
    example: 'https://stellar.expert/explorer',
  })
  explorerUrl!: string;
}
