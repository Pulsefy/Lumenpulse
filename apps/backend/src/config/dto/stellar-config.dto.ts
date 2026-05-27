import { ApiProperty } from '@nestjs/swagger';

export class StellarContractsDto {
  @ApiProperty({
    description: 'Lumen token contract address',
    example: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    nullable: true,
  })
  lumenToken: string | null;

  @ApiProperty({
    description: 'Crowdfund vault contract address',
    example: 'CABL2E2NKLCQIRSF6BXVB4NLSDBNJ2QBFVGXNLGBMZFDWRQKQ7MWDKD',
    nullable: true,
  })
  crowdfundVault: string | null;

  @ApiProperty({
    description: 'Project registry contract address',
    example: 'CBSXTJCDVNR4QSUVVNRPUOMXZUWUBEYZQQKDXIYWF2FNXLBOPSTXGAGK',
    nullable: true,
  })
  projectRegistry: string | null;

  @ApiProperty({
    description: 'Contributor registry contract address',
    example: 'CDRP4QZJFJDUGBMN35GGRQBIZSGD3CQZIJFM4CLHZLGQDGZQ3JKWFPQ',
    nullable: true,
  })
  contributorRegistry: string | null;

  @ApiProperty({
    description: 'Matching pool contract address',
    nullable: true,
  })
  matchingPool: string | null;

  @ApiProperty({
    description: 'Treasury contract address',
    nullable: true,
  })
  treasury: string | null;
}

export class StellarConfigResponseDto {
  @ApiProperty({
    description: 'Stellar network name',
    enum: ['testnet', 'mainnet'],
    example: 'testnet',
  })
  network: 'testnet' | 'mainnet';

  @ApiProperty({
    description: 'Stellar Horizon API URL',
    example: 'https://horizon-testnet.stellar.org',
  })
  horizonUrl: string;

  @ApiProperty({
    description: 'Stellar Soroban RPC URL',
    example: 'https://soroban-testnet.stellar.org',
    nullable: true,
  })
  sorobanRpcUrl: string | null;

  @ApiProperty({
    description: 'Network passphrase for transaction signing',
    example: 'Test SDF Network ; September 2015',
  })
  networkPassphrase: string;

  @ApiProperty({
    description: 'Deployed Soroban contract addresses',
    type: StellarContractsDto,
  })
  contracts: StellarContractsDto;
}
