import { ApiProperty } from '@nestjs/swagger';

export class IngestSorobanEventResponseDto {
  @ApiProperty({
    description: 'Unique event ID assigned by the system upon ingestion',
    example: '507f1f77bcf86cd799439011',
  })
  id: string;

  @ApiProperty({
    description: 'Transaction hash of the event',
    example: 'abc123def456ghi789jkl012mno345pqr678stu901vwx234yz567abc890',
  })
  txHash: string;

  @ApiProperty({
    description: 'Event index within the transaction',
    example: 0,
  })
  eventIndex: number;

  @ApiProperty({
    description: 'Contract ID that emitted the event',
    example: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    nullable: true,
  })
  contractId: string | null;

  @ApiProperty({
    description: 'Type of event emitted by the contract',
    example: 'transfer',
    nullable: true,
  })
  eventType: string | null;

  @ApiProperty({
    description: 'Current processing status of the event',
    enum: ['PENDING', 'PROCESSED', 'FAILED'],
    example: 'PENDING',
  })
  status: 'PENDING' | 'PROCESSED' | 'FAILED';

  @ApiProperty({
    description: 'Timestamp when the event was ingested',
    example: '2024-03-15T10:30:00Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'Timestamp of last status update',
    example: '2024-03-15T10:30:05Z',
  })
  updatedAt: string;
}
