import { ApiProperty } from '@nestjs/swagger';

export enum SignalCategory {
  HOLDINGS = 'holdings',
  ACTIVITY = 'activity',
  RISK = 'risk',
  FALLBACK = 'fallback',
}

export enum SignalSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export class UserSignalDto {
  @ApiProperty({ enum: SignalCategory })
  category: SignalCategory;

  @ApiProperty({ enum: SignalSeverity })
  severity: SignalSeverity;

  @ApiProperty({ description: 'Short signal title' })
  title: string;

  @ApiProperty({ description: 'Detailed signal explanation' })
  detail: string;
}

export class UserSignalsResponseDto {
  @ApiProperty({ description: 'User identifier' })
  userId: string;

  @ApiProperty({ description: 'Time when signals were generated' })
  generatedAt: Date;

  @ApiProperty({
    type: [UserSignalDto],
    description: 'Latest deterministic signals for the user',
  })
  signals: UserSignalDto[];
}
