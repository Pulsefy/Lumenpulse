import { ApiProperty } from '@nestjs/swagger';

export class SeededEntity {
  @ApiProperty({ description: 'Entity type that was seeded', example: 'users' })
  type: string;

  @ApiProperty({ description: 'Number of records seeded', example: 3 })
  count: number;

  @ApiProperty({ description: 'Sample identifiers of seeded records', example: ['uuid-1', 'uuid-2'] })
  ids: string[];
}

export class BootstrapResponseDto {
  @ApiProperty({ description: 'Whether the bootstrap was successful' })
  success: boolean;

  @ApiProperty({
    description: 'Breakdown of seeded entities',
    type: [SeededEntity],
  })
  seeded: SeededEntity[];

  @ApiProperty({
    description: 'Human-readable summary',
    example: 'Bootstrapped 3 users, 4 projects, 5 news articles',
  })
  summary: string;

  @ApiProperty({ description: 'ISO timestamp of the bootstrap event' })
  timestamp: string;

  @ApiProperty({ description: 'Stellar network context', example: 'testnet' })
  network: string;
}
