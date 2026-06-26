import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SessionDto {
  @ApiProperty({
    description: 'Unique session identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiPropertyOptional({
    description: 'Device information (user agent or device name)',
    example: 'iPhone 15 Pro - Safari',
    nullable: true,
  })
  deviceInfo?: string | null;

  @ApiPropertyOptional({
    description: 'IP address of the device',
    example: '192.168.1.1',
    nullable: true,
  })
  ipAddress?: string | null;

  @ApiProperty({
    description: 'When this session was created',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'When this session expires',
    example: '2024-02-14T10:30:00Z',
  })
  expiresAt: Date;

  @ApiProperty({
    description: 'Whether this is the current active session',
    example: true,
  })
  isCurrent: boolean;
}

export class ActiveSessionsResponseDto {
  @ApiProperty({
    description: 'List of active sessions',
    type: [SessionDto],
  })
  @Type(() => SessionDto)
  sessions: SessionDto[];

  @ApiProperty({
    description: 'Total number of active sessions',
    example: 3,
  })
  total: number;
}

export class RevokeSessionResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: 'Session revoked successfully',
  })
  message: string;

  @ApiProperty({
    description: 'ID of the revoked session',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  sessionId: string;
}
