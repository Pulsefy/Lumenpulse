import { ApiProperty } from '@nestjs/swagger';
import { DeadLetterStatus } from '../entities/soroban-event-dead-letter.entity';

export class DeadLetterErrorHistoryDto {
  @ApiProperty({
    description: 'ISO timestamp of the error',
    example: '2024-01-15T10:30:00Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Error message',
    example: 'Contract not found on ledger',
  })
  message: string;

  @ApiProperty({
    description: 'Stack trace for debugging',
    example: 'Error: Contract not found\n    at processEvent...',
    required: false,
  })
  stack?: string;
}

export class DeadLetterEventDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  sorobanEventId: string | null;

  @ApiProperty({
    example: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
    description: 'Transaction hash',
  })
  txHash: string;

  @ApiProperty({ example: 0, description: 'Event index within transaction' })
  eventIndex: number;

  @ApiProperty({
    example: 'CAF5YZ3XZWHMNQYZPJ4YVGJJTKP3N6DSZXQFUTW7QPEHQ3KBFQMJDP',
    nullable: true,
  })
  contractId: string | null;

  @ApiProperty({ example: 'transfer', nullable: true })
  eventType: string | null;

  @ApiProperty({ example: 'token_transfer', nullable: true })
  canonicalType: string | null;

  @ApiProperty({ example: 'financial', nullable: true })
  category: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Original event payload',
  })
  rawPayload: Record<string, unknown>;

  @ApiProperty({
    example: 47831234,
    nullable: true,
    description: 'Ledger sequence number',
  })
  ledgerSequence: number | null;

  @ApiProperty({
    example: 3,
    description: 'Number of failed processing attempts',
  })
  failureCount: number;

  @ApiProperty({
    example: 'Contract reference not found',
    nullable: true,
  })
  lastErrorMessage: string | null;

  @ApiProperty({
    type: [DeadLetterErrorHistoryDto],
    description: 'History of all errors encountered',
  })
  errorHistory: DeadLetterErrorHistoryDto[];

  @ApiProperty({
    enum: DeadLetterStatus,
    example: DeadLetterStatus.PENDING,
  })
  status: DeadLetterStatus;

  @ApiProperty({
    example: 'Investigated: contract deployed later, requires replay',
    nullable: true,
  })
  maintainerNotes: string | null;

  @ApiProperty({
    example: 1,
    description: 'Number of times event was replayed from dead letter',
  })
  replayCount: number;

  @ApiProperty({
    example: '2024-01-15T10:35:00Z',
    nullable: true,
  })
  lastReplayedAt: Date | null;

  @ApiProperty({
    example: '2024-01-15T12:00:00Z',
    nullable: true,
  })
  resolvedAt: Date | null;

  @ApiProperty({
    example: 'maintainer@example.com',
    nullable: true,
  })
  resolvedBy: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class ListDeadLetterEventsQueryDto {
  @ApiProperty({
    example: 0,
    required: false,
    description: 'Page number (zero-indexed)',
  })
  page?: number = 0;

  @ApiProperty({
    example: 20,
    required: false,
    description: 'Number of results per page',
  })
  limit?: number = 20;

  @ApiProperty({
    enum: DeadLetterStatus,
    required: false,
    description: 'Filter by status',
  })
  status?: DeadLetterStatus;

  @ApiProperty({
    example: 'transfer',
    required: false,
    description: 'Filter by event type',
  })
  eventType?: string;

  @ApiProperty({
    example: 'CAF5YZ3XZWHMNQYZPJ4YVGJJTKP3N6DSZXQFUTW7QPEHQ3KBFQMJDP',
    required: false,
    description: 'Filter by contract ID',
  })
  contractId?: string;

  @ApiProperty({
    example: 'createdAt',
    required: false,
    enum: ['createdAt', 'failureCount', 'lastAttemptAt'],
    description: 'Sort field',
  })
  sortBy?: 'createdAt' | 'failureCount' | 'lastAttemptAt' = 'createdAt';

  @ApiProperty({
    example: 'DESC',
    required: false,
    enum: ['ASC', 'DESC'],
    description: 'Sort order',
  })
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}

export class PaginatedDeadLetterResponseDto {
  @ApiProperty({
    type: [DeadLetterEventDto],
  })
  data: DeadLetterEventDto[];

  @ApiProperty({
    example: 0,
  })
  page: number;

  @ApiProperty({
    example: 20,
  })
  limit: number;

  @ApiProperty({
    example: 150,
  })
  total: number;

  @ApiProperty({
    example: 8,
  })
  totalPages: number;
}

export class ReplayDeadLetterEventDto {
  @ApiProperty({
    example: 'Replaying after contract deployment',
    required: false,
    description: 'Optional reason for replay',
  })
  reason?: string;
}

export class ReplayDeadLetterResponseDto {
  @ApiProperty({
    example: 'Event queued for replay',
  })
  message: string;

  @ApiProperty({
    example: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6:0',
  })
  jobId: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  eventId: string;

  @ApiProperty({
    example: 2,
  })
  replayCount: number;
}

export class ResolveDeadLetterEventDto {
  @ApiProperty({
    description: 'Reason for resolution',
    example: 'Acknowledged as unfixable due to deprecated contract',
  })
  reason: string;

  @ApiProperty({
    description: 'User/service resolving the event',
    example: 'maintainer@example.com',
    required: false,
  })
  resolvedBy?: string;
}

export class ResolveDeadLetterResponseDto {
  @ApiProperty({
    example: 'Event marked as resolved',
  })
  message: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  eventId: string;

  @ApiProperty({
    example: DeadLetterStatus.RESOLVED,
  })
  status: DeadLetterStatus;

  @ApiProperty({
    example: '2024-01-15T12:00:00Z',
  })
  resolvedAt: Date;
}

export class DeadLetterStatsDto {
  @ApiProperty({
    description: 'Total number of events in dead letter queue',
    example: 42,
  })
  total: number;

  @ApiProperty({
    description: 'Number of unresolved events',
    example: 15,
  })
  pending: number;

  @ApiProperty({
    description: 'Number of successfully replayed events',
    example: 25,
  })
  replayed: number;

  @ApiProperty({
    description: 'Number of resolved events',
    example: 2,
  })
  resolved: number;

  @ApiProperty({
    description: 'Most common error',
    example: 'Contract reference not found',
  })
  mostCommonError: string | null;

  @ApiProperty({
    description: 'Oldest unresolved event creation timestamp',
    example: '2024-01-10T08:00:00Z',
    nullable: true,
  })
  oldestUnresolvedAt: Date | null;
}
