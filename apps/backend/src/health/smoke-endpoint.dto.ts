import { ApiProperty } from '@nestjs/swagger';

export class SmokeEnvVarCheck {
  @ApiProperty({
    description: 'Environment variable name',
    example: 'STELLAR_HORIZON_URL',
  })
  name: string;

  @ApiProperty({
    description: 'Whether the environment variable is set',
    example: true,
  })
  configured: boolean;

  @ApiProperty({
    description: 'Current value (redacted if sensitive)',
    example: 'https://horizon-testnet.stellar.org',
    nullable: true,
  })
  value?: string;
}

export class SmokeContractCheck {
  @ApiProperty({
    description: 'Contract name',
    example: 'lumenToken',
  })
  name: string;

  @ApiProperty({
    description: 'Environment variable name',
    example: 'STELLAR_CONTRACT_LUMEN_TOKEN',
  })
  envVar: string;

  @ApiProperty({
    description: 'Whether the contract ID is configured',
    example: true,
  })
  configured: boolean;

  @ApiProperty({
    description: 'Contract reachability status',
    enum: ['reachable', 'misconfigured', 'unreachable'],
    example: 'reachable',
  })
  status: 'reachable' | 'misconfigured' | 'unreachable';

  @ApiProperty({
    description: 'Redacted contract ID for verification',
    example: 'CDLZF...T7GY6',
    nullable: true,
  })
  contractId?: string;
}

export class SmokeEndpointReport {
  @ApiProperty({
    description: 'Overall smoke test status',
    enum: ['ok', 'error'],
    example: 'ok',
  })
  status: 'ok' | 'error';

  @ApiProperty({
    description: 'Network being checked',
    enum: ['testnet', 'mainnet'],
    example: 'testnet',
  })
  network: 'testnet' | 'mainnet';

  @ApiProperty({
    description: 'When the smoke test was performed',
    example: '2024-01-15T10:30:00.000Z',
  })
  checkedAt: string;

  @ApiProperty({
    description: 'Required environment variable checks',
    type: [SmokeEnvVarCheck],
  })
  envVars: SmokeEnvVarCheck[];

  @ApiProperty({
    description: 'Contract reachability checks',
    type: [SmokeContractCheck],
  })
  contracts: SmokeContractCheck[];
}