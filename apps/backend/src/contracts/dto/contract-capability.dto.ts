import { ApiProperty } from '@nestjs/swagger';

export class ContractMethodDto {
  @ApiProperty({
    description: 'Name of the contract method',
    example: 'get_admin',
  })
  name: string;

  @ApiProperty({
    description: 'Method category (read-only, write, admin-only)',
    enum: ['read-only', 'write', 'admin-only'],
    example: 'read-only',
  })
  category: string;

  @ApiProperty({
    description: 'Brief description of what the method does',
    example: 'Returns the admin address for the contract',
  })
  description: string;

  @ApiProperty({
    description: 'Whether this method is publicly callable by clients',
    example: true,
  })
  public: boolean;
}

export class ContractCapabilityDto {
  @ApiProperty({
    description: 'Unique identifier for the contract',
    example: 'creator-registry',
  })
  contractId: string;

  @ApiProperty({
    description: 'Human-readable display name for the contract',
    example: 'Creator Registry',
  })
  displayName: string;

  @ApiProperty({
    description: 'Contract version',
    example: '1.0.0',
  })
  version: string;

  @ApiProperty({
    description: 'Current status of the contract',
    enum: ['active', 'deprecated', 'upcoming'],
    example: 'active',
  })
  status: string;

  @ApiProperty({
    description: 'Contract category',
    enum: [
      'token',
      'registry',
      'vault',
      'pool',
      'treasury',
      'vesting',
      'adapter',
    ],
    example: 'registry',
  })
  category: string;

  @ApiProperty({
    description: 'Contract address on the blockchain',
    example: 'CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB',
    nullable: true,
  })
  address: string | null;

  @ApiProperty({
    description: 'List of supported public methods',
    type: [ContractMethodDto],
  })
  supportedMethods: ContractMethodDto[];

  @ApiProperty({
    description: 'Network where this contract is deployed',
    enum: ['testnet', 'mainnet'],
    example: 'testnet',
  })
  network: string;

  @ApiProperty({
    description: 'Last validation timestamp',
    example: '2026-06-28T10:00:00Z',
  })
  lastValidatedAt: string;
}

export class ContractCapabilityCatalogResponseDto {
  @ApiProperty({
    description: 'Environment name',
    example: 'development',
  })
  environment: string;

  @ApiProperty({
    description: 'API version',
    example: 'v1',
  })
  apiVersion: string;

  @ApiProperty({
    description: 'Catalog version',
    example: '1.0.0',
  })
  catalogVersion: string;

  @ApiProperty({
    description: 'Catalog generation timestamp',
    example: '2026-06-28T10:00:00Z',
  })
  generatedAt: string;

  @ApiProperty({
    description: 'List of available contracts with their capabilities',
    type: [ContractCapabilityDto],
  })
  contracts: ContractCapabilityDto[];
}
