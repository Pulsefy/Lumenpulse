import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReplaySorobanRangeDto {
  @ApiProperty({
    description: 'First ledger in the range to replay',
    example: 1000,
  })
  @IsInt()
  @Min(0)
  startLedger: number;

  @ApiProperty({
    description: 'Last ledger in the range to replay (inclusive)',
    example: 2000,
  })
  @IsInt()
  @Min(0)
  endLedger: number;

  @ApiProperty({
    description: 'Optional contract ID to filter replayed events',
    example: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    required: false,
    nullable: true,
  })
  @IsOptional()
  contractId?: string;

  @ApiProperty({
    description: 'If true, only report what would change without writing',
    example: false,
    default: false,
  })
  @IsOptional()
  dryRun?: boolean;
}

export class ReplaySorobanRangeResponseDto {
  @ApiProperty({
    description: 'Number of events that would be (or were) processed',
    example: 150,
  })
  totalEvents: number;

  @ApiProperty({
    description: 'Number of events actually written (0 in dry-run)',
    example: 150,
  })
  indexed: number;

  @ApiProperty({
    description: 'Number of events skipped because they already existed',
    example: 12,
  })
  skipped: number;

  @ApiProperty({
    description: 'Whether this was a dry-run',
    example: false,
  })
  dryRun: boolean;

  @ApiProperty({
    description: 'Start ledger of the replayed range',
    example: 1000,
  })
  startLedger: number;

  @ApiProperty({
    description: 'End ledger of the replayed range',
    example: 2000,
  })
  endLedger: number;

  @ApiProperty({
    description: 'Optional contract filter used',
    example: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    nullable: true,
  })
  contractId: string | null;

  @ApiProperty({
    description: 'Human-readable summary of the operation',
    example: 'Replayed 150 events for contract CA... in ledgers 1000–2000',
  })
  summary: string;
}
