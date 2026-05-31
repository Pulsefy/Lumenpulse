import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class IngestSorobanEventDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Stellar transaction hash containing this Soroban event',
    example: 'abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567abc890',
  })
  txHash: string;

  @IsInt()
  @Min(0)
  @ApiProperty({
    description: 'Index of the event within the transaction (0-based)',
    example: 0,
  })
  eventIndex: number;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description: 'Soroban contract ID (address) that emitted this event',
    example: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    required: false,
    nullable: true,
  })
  contractId?: string;

  @IsString()
  @IsOptional()
  @ApiProperty({
    description:
      'Type of Soroban event (e.g., "transfer", "mint", "burn", "contribution")',
    example: 'transfer',
    required: false,
    nullable: true,
  })
  eventType?: string;

  @IsObject()
  @ApiProperty({
    description:
      'Raw event payload as emitted by the Soroban contract (event data)',
    example: {
      from: 'GBUQWP3BOUZX34ULNQG23RQ6F4BWFIREXOWJ2GY2FOLGABIDESX56JP2',
      to: 'GBUQWP3BOUZX34ULNQG23RQ6F4BWFIREGOWJ2GY2FOLGABIDES4PJ4Q',
      amount: '1000000',
    },
  })
  rawPayload: Record<string, unknown>;
}
