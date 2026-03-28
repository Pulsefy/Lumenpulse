import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { UserPreferences } from '../entities/user.entity';

export class ProfileResponseDto {
  @ApiProperty({ description: 'User unique identifier' })
  id: string;

  @ApiProperty({ description: 'User email address' })
  email: string;

  @ApiPropertyOptional({ description: 'User first name' })
  firstName?: string;

  @ApiPropertyOptional({ description: 'User last name' })
  lastName?: string;

  @ApiPropertyOptional({ description: 'User display name' })
  displayName?: string;

  @ApiPropertyOptional({ description: 'User bio/description' })
  bio?: string;

  @ApiPropertyOptional({ description: 'URL to user avatar image' })
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Primary Stellar public key' })
  stellarPublicKey?: string;

  @ApiPropertyOptional({
    description: 'User preferences',
    type: 'object',
    additionalProperties: true,
  })
  preferences?: UserPreferences;

  @ApiProperty({ description: 'Account creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Account last update timestamp' })
  updatedAt: Date;

  constructor(partial: Partial<ProfileResponseDto>) {
    Object.assign(this, partial);
  }
}
