import { ApiProperty } from '@nestjs/swagger';

export class StellarContractsDto {
  @ApiProperty({
    description: 'Lumen token contract address - ERC-20 style token on Soroban',
    example: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    nullable: true,
  })
  lumenToken: string | null;

  @ApiProperty({
    description:
      'Crowdfund vault contract address - holds contributions and manages distributions',
    example: 'CABL2E2NKLCQIRSF6BXVB4NLSDBNJ2QBFVGXNLGBMZFDWRQKQ7MWDKD',
    nullable: true,
  })
  crowdfundVault: string | null;

  @ApiProperty({
    description:
      'Project registry contract address - stores project metadata and configurations',
    example: 'CBSXTJCDVNR4QSUVVNRPUOMXZUWUBEYZQQKDXIYWF2FNXLBOPSTXGAGK',
    nullable: true,
  })
  projectRegistry: string | null;

  @ApiProperty({
    description:
      'Contributor registry contract address - tracks contributor information and permissions',
    example: 'CDRP4QZJFJDUGBMN35GGRQBIZSGD3CQZIJFM4CLHZLGQDGZQ3JKWFPQ',
    nullable: true,
  })
  contributorRegistry: string | null;

  @ApiProperty({
    description:
      'Matching pool contract address - manages quadratic funding matching amounts',
    example: 'CDURBNFXXVW7GY66N3Z7QZJSW3KQLQJT2OKNZCWHOMAQHJTBZSPXRFZF',
    nullable: true,
  })
  matchingPool: string | null;

  @ApiProperty({
    description:
      'Treasury contract address - manages protocol funds and reserves',
    example: 'CAZVNFM6WVCDGCFJQFXZZP2SYO4LZJL3KSQRQKNJ2HXMYQFQHDPQ5QBT',
    nullable: true,
  })
  treasury: string | null;
}

export class StellarConfigResponseDto {
  @ApiProperty({
    description:
      'Stellar network name - indicates whether this is testnet or mainnet configuration',
    enum: ['testnet', 'mainnet'],
    example: 'testnet',
  })
  network: 'testnet' | 'mainnet';

  @ApiProperty({
    description:
      'Stellar Horizon API URL - primary REST API for querying Stellar ledger data and submitting transactions',
    example: 'https://horizon-testnet.stellar.org',
  })
  horizonUrl: string;

  @ApiProperty({
    description:
      'Stellar Soroban RPC URL - JSON-RPC endpoint for interacting with Soroban smart contracts',
    example: 'https://soroban-testnet.stellar.org',
    nullable: true,
  })
  sorobanRpcUrl: string | null;

  @ApiProperty({
    description:
      'Network passphrase for transaction signing - used when building transactions to prevent cross-network replays',
    example: 'Test SDF Network ; September 2015',
  })
  networkPassphrase: string;

  @ApiProperty({
    description:
      'Deployed Soroban contract addresses on the specified network. All values may be null if not deployed.',
    type: StellarContractsDto,
  })
  contracts: StellarContractsDto;
}
