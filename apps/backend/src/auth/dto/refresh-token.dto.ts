import { IsString, IsNotEmpty, IsOptional, IsIP } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty({ message: 'Refresh token is required' })
  refreshToken: string;

  @ApiProperty({
    description: 'Device information for tracking',
    example: 'iPhone 15 Pro',
    required: false,
  })
  @IsOptional()
  @IsString()
  deviceInfo?: string;

  @ApiProperty({
    description: 'IP address for tracking',
    example: '192.168.1.1',
    required: false,
  })
  @IsOptional()
  @IsIP()
  ipAddress?: string;
}

export class LogoutDto {
  @ApiProperty({
    description: 'Refresh token to invalidate',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @IsNotEmpty({ message: 'Refresh token is required' })
  refreshToken: string;
}
